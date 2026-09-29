import { describe, expect, it } from "vitest";
import { calculatePL, defaultActuals } from "@/lib/calculations";
import { calculateSurveyDayRequirement, calculateSurveyProject, calculateSurveySiteDays } from "@/lib/costing/survey/calculations";
import { createEmptySurveyInput, defaultSurveyRates, normaliseSurveyRates } from "@/lib/costing/survey/defaults";
import { createSurveyProjectInput } from "@/lib/costing/survey/project";
import { defaultCompanies, distanceRateUnit, distanceUnitCopy } from "@/lib/company";
import { projectToRow, rowToProject } from "@/lib/storage";
import { defaultRates } from "@/lib/rates";
import type { ProjectRecord } from "@/lib/types";
import { changeSurveyType, defaultSurveyVehicleCount, surveyFields } from "@/lib/costing/survey/rules";
import { buildHandoverSummary } from "@/lib/handover";

function inHouseSurvey() {
  return {
    ...createEmptySurveyInput("EUR", "km"),
    projectReference: "SUR-001",
    client: "Example Client",
    location: "Berlin",
    autoStoreArea: 6500,
    surveyorsOnSite: 1,
    numberOfProfs: 1,
    hotelRequired: true,
    weekendDaysWorked: 1,
    weekendDaysNotWorked: 1,
    primaryOfficeDistanceOneWay: 650,
    driveTimeOneWayDays: 1,
    numberOfCars: 1,
    surveyReport: true
  };
}

describe("separate Survey costing module", () => {
  it("starts a blank Survey project with zero quantities and zero cost", () => {
    const input = createEmptySurveyInput("EUR", "km");
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(input.surveyorsOnSite).toBe(0);
    expect(input.numberOfProfs).toBe(0);
    expect(input.selectedEquipment).toEqual([]);
    expect(input.subcontractSurveyCost).toBe(0);
    expect(result.siteDays).toBe(0);
    expect(result.proposalTotal).toBe(0);
    expect(result.budgetCost).toBe(0);
    expect(result.bdmBonusBudget).toBe(0);
  });

  it("calculates site days from company-admin daily outputs", () => {
    const input = inHouseSurvey();
    expect(calculateSurveyProject(input, defaultSurveyRates).siteDays).toBe(7);
    expect(calculateSurveyProject(input, { ...defaultSurveyRates, dailyOutputAutoStoreArea: 2000 }).siteDays).toBe(4);
  });

  it("allows rounded calculated Survey days to be overridden with whole site days", () => {
    const input = { ...inHouseSurvey(), autoStoreArea: 1100 };
    expect(calculateSurveyDayRequirement(input, defaultSurveyRates)).toBe(1.1);
    expect(calculateSurveySiteDays(input, defaultSurveyRates)).toBe(2);
    const automatic = calculateSurveyProject(input, defaultSurveyRates);
    const overridden = calculateSurveyProject({ ...input, siteDaysOverride: 1 }, defaultSurveyRates);
    expect(automatic.siteDays).toBe(2);
    expect(overridden.survey?.calculatedSiteDays).toBe(2);
    expect(overridden.survey?.calculatedDayRequirement).toBe(1.1);
    expect(overridden.survey?.siteDaysOverridden).toBe(true);
    expect(overridden.siteDays).toBe(1);
    expect(overridden.proposalLines.find((line) => line.item === "Surveyor")?.quantity).toBe(1);
  });

  it("uses the company-standard quantity fields for each survey type", () => {
    expect(surveyFields.AutoStore).toEqual(["autoStoreArea"]);
    expect(surveyFields.Fmin).toEqual(["fminRuns"]);
    expect(surveyFields.Exotec).toEqual(["exotecRuns", "exotecArea"]);
    expect(surveyFields.Robotics).toEqual(["roboticsArea", "fminRuns"]);
    expect(surveyFields["Level Survey Only"]).toEqual(["levelSurveyArea"]);
    expect(surveyFields["Prof Runs Only"]).toEqual(["profRunsOnly"]);
    expect(surveyFields.Bespoke).toHaveLength(7);
  });

  it("clears old scope quantities when the survey type changes", () => {
    const changed = changeSurveyType({ ...inHouseSurvey(), fminRuns: 1200, exotecArea: 5000, siteDaysOverride: 3 }, "Fmin");
    expect(changed.surveyType).toBe("Fmin");
    expect(changed.autoStoreArea).toBe(0);
    expect(changed.fminRuns).toBe(0);
    expect(changed.exotecArea).toBe(0);
    expect(changed.siteDaysOverride).toBeNull();
  });

  it("ignores stale quantities that do not belong to the selected survey type", () => {
    const input = { ...inHouseSurvey(), surveyType: "AutoStore" as const, fminRuns: 9000, exotecArea: 12000 };
    expect(calculateSurveyProject(input, defaultSurveyRates).siteDays).toBe(7);
  });

  it("uses budget plus markup to calculate proposal values", () => {
    const result = calculateSurveyProject(inHouseSurvey(), defaultSurveyRates);
    const surveyor = result.proposalLines.find((line) => line.item === "Surveyor")!;
    expect(surveyor.cost).toBe(3850);
    expect(surveyor.total).toBe(8400);
    expect(surveyor.total).toBeCloseTo(surveyor.cost * (1 + defaultSurveyRates.surveyorMarkup), 2);
    expect(result.budgetMarkup).toBeGreaterThan(0);
  });

  it("prices multiple catalogue equipment quantities per site day or deployment", () => {
    const rates = normaliseSurveyRates({
      ...defaultSurveyRates,
      equipmentCatalog: [
        { id: "level-kit", name: "Level Survey Kit", purchaseCost: 10000, recoveryUnits: 200, budgetRate: 50, markup: 0.3, chargingBasis: "site_day", active: true, checklistNotes: "Include tripod" },
        { id: "scanner", name: "Scanner", purchaseCost: 20000, recoveryUnits: 100, budgetRate: 200, markup: 0.25, chargingBasis: "deployment", active: true, checklistNotes: "Confirm calibration" }
      ]
    });
    const input = { ...inHouseSurvey(), numberOfProfs: 0, selectedEquipment: [{ equipmentId: "level-kit", quantity: 2 }, { equipmentId: "scanner", quantity: 3 }] };
    const result = calculateSurveyProject(input, rates);
    const levelKit = result.proposalLines.find((line) => line.item === "Level Survey Kit")!;
    const scanner = result.proposalLines.find((line) => line.item === "Scanner")!;
    expect(result.siteDays).toBe(7);
    expect(levelKit.quantity).toBe(14);
    expect(levelKit.cost).toBe(700);
    expect(levelKit.total).toBe(910);
    expect(scanner.quantity).toBe(3);
    expect(scanner.cost).toBe(600);
    expect(scanner.total).toBe(750);
  });

  it("keeps catalogue equipment, reports and additional costs out of mobilisation", () => {
    const rates = normaliseSurveyRates({ ...defaultSurveyRates, equipmentCatalog: [{ id: "level-kit", name: "Level Survey Kit", purchaseCost: 10000, recoveryUnits: 200, budgetRate: 50, markup: 0.3, chargingBasis: "site_day", active: true, checklistNotes: "" }] });
    const input = {
      ...createEmptySurveyInput("EUR", "km"),
      projectReference: "SUR-MOB",
      client: "Client",
      location: "Site",
      autoStoreArea: 1000,
      surveyorsOnSite: 1,
      selectedEquipment: [{ equipmentId: "level-kit", quantity: 1 }],
      surveyReport: true,
      additionalItems: [{ id: "extra", name: "Direct fee", rate: 100, unit: "item", quantity: 1, markup: 0.2, plCategory: "Equipment" as const }]
    };
    const result = calculateSurveyProject(input, rates);
    expect(result.mobilisationRate).toBe(0);
    expect(result.mobilisationBudget).toBe(0);
    expect(result.proposalLines.find((line) => line.item === "Level Survey Kit")?.costKind).toBe("operating");
    expect(result.proposalLines.find((line) => line.item === "Engineering Report")?.costKind).toBe("operating");
  });

  it("preserves the historical profiler total until an old project is deliberately changed", () => {
    const legacy = calculateSurveyProject({ ...inHouseSurvey(), numberOfProfs: 2, selectedEquipment: [] }, defaultSurveyRates);
    const catalogue = calculateSurveyProject({ ...inHouseSurvey(), numberOfProfs: 0, selectedEquipment: [{ equipmentId: "profiler-equipment", quantity: 2 }] }, defaultSurveyRates);
    expect(legacy.proposalLines.find((line) => line.item === "Equipment Rental")?.total).toBe(3024);
    expect(catalogue.proposalLines.find((line) => line.item === "Profiler Equipment")?.total).toBe(3024);
    expect(catalogue.proposalTotal).toBe(legacy.proposalTotal);
    expect(catalogue.budgetCost).toBe(legacy.budgetCost);
  });

  it("defaults a drive journey to one vehicle without overwriting a manual choice", () => {
    const blank = createEmptySurveyInput("EUR", "km");
    expect(defaultSurveyVehicleCount(blank, 100, 0)).toBe(1);
    expect(defaultSurveyVehicleCount({ ...blank, numberOfCars: 2 }, 100, 0)).toBe(2);
    expect(defaultSurveyVehicleCount({ ...blank, numberOfCarsOverridden: true }, 100, 0)).toBe(0);
    expect(defaultSurveyVehicleCount({ ...blank, travelMode: "Fly" }, 100, 0)).toBe(0);
  });

  it("adds selected equipment quantities and notes to the PM handover checks", () => {
    const rates = normaliseSurveyRates({ ...defaultSurveyRates, equipmentCatalog: [{ id: "level-kit", name: "Level Survey Kit", purchaseCost: 10000, recoveryUnits: 200, budgetRate: 50, markup: 0.3, chargingBasis: "site_day", active: true, checklistNotes: "Include tripod and charger" }] });
    const inputs = createSurveyProjectInput("EUR", "km", { ...inHouseSurvey(), numberOfProfs: 0, selectedEquipment: [{ equipmentId: "level-kit", quantity: 2 }] });
    const project: ProjectRecord = { id: "equipment-handover", companyId: "face", createdAt: "2026-09-29T00:00:00.000Z", status: "Costing Complete", accountsStatus: "Not Required", inputs, calculations: calculateSurveyProject(inputs.survey!, rates), rateSnapshot: { ...defaultRates, surveyRates: rates } };
    expect(buildHandoverSummary(project).actions).toContain("Confirm 2 x Level Survey Kit - Include tripod and charger");
  });

  it("replaces the complete surveyor package when subcontracted and applies markup", () => {
    const input = { ...inHouseSurvey(), surveyorSupply: "Subcontracted" as const, subcontractSurveyCost: 5000, subcontractSurveyMarkup: 0.3 };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.proposalLines.find((line) => line.item === "Subcontracted Survey Package")?.total).toBe(6500);
    expect(result.budgetLines.find((line) => line.item === "Subcontracted Survey Package")?.total).toBe(5000);
    for (const item of ["Surveyor", "Surveyor Travel", "Surveyor Hotel", "Surveyor Subsistence", "Kilometres", "Company Car"]) {
      expect(result.proposalLines.find((line) => line.item === item)?.quantity ?? 0, item).toBe(0);
    }
  });

  it("ignores hidden travel values for a subcontract-only survey package", () => {
    const input = { ...inHouseSurvey(), surveyorSupply: "Subcontracted" as const, subcontractSurveyCost: 5000, subcontractSurveyMarkup: 0.3, travelMode: "Fly" as const, additionalFlights: 4, airportTransport: "Uber" as const };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    for (const item of ["Return Flight", "Return Airport Transfer", "Airport Parking", "Surveyor Hotel", "Surveyor Subsistence", "Company Car", "Car Rental"]) {
      expect(result.proposalLines.find((line) => line.item === item)?.quantity ?? 0, item).toBe(0);
    }
  });

  it("does not charge flight or airport inputs while Drive is selected", () => {
    const input = { ...inHouseSurvey(), travelMode: "Drive" as const, additionalFlights: 3, airportTransport: "Uber" as const };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.proposalLines.find((line) => line.item === "Return Flight")?.quantity).toBe(0);
    expect(result.proposalLines.find((line) => line.item === "Return Airport Transfer")?.quantity).toBe(0);
  });

  it("adds Project Manager labour and logistics independently of a subcontract package", () => {
    const input = { ...inHouseSurvey(), surveyorSupply: "Subcontracted" as const, subcontractSurveyCost: 5000, subcontractSurveyMarkup: 0.3, projectManagerRequired: true };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.proposalLines.find((line) => line.item === "Project Manager")?.quantity).toBe(7);
    expect(result.proposalLines.find((line) => line.item === "Project Manager Travel")?.quantity).toBe(2);
    expect(result.proposalLines.find((line) => line.item === "Project Manager Hotel")?.quantity).toBe(9);
    expect(result.proposalLines.find((line) => line.item === "Kilometres")?.quantity).toBe(1300);
  });

  it("retains the company's selected distance unit in the project and costing lines", () => {
    const milesInput = { ...inHouseSurvey(), distanceUnit: "miles" as const };
    const projectInput = createSurveyProjectInput("GBP", "miles", milesInput);
    const result = calculateSurveyProject(projectInput.survey!, defaultSurveyRates);
    expect(projectInput.distanceUnit).toBe("miles");
    expect(projectInput.survey?.distanceUnit).toBe("miles");
    expect(result.proposalLines.find((line) => line.item === "Mileage")?.unit).toBe("mile");
    expect(distanceRateUnit("km")).toBe("km");
    expect(distanceUnitCopy("miles").plural).toBe("miles");
  });

  it("snapshots and applies the company's office journey configuration", () => {
    const oneOffice = { ...inHouseSurvey(), officeCount: 1 as const, primaryOfficeDistanceOneWay: 120, secondaryOfficeDistanceOneWay: 0 };
    const twoOffices = { ...inHouseSurvey(), officeCount: 2 as const, primaryOfficeDistanceOneWay: 120, secondaryOfficeDistanceOneWay: 180 };
    expect(calculateSurveyProject(oneOffice, defaultSurveyRates).survey?.chargeableDistance).toBe(240);
    expect(calculateSurveyProject(twoOffices, defaultSurveyRates).survey?.chargeableDistance).toBe(300);
    expect(createSurveyProjectInput("EUR", "km", undefined, 2).survey?.officeCount).toBe(2);
  });

  it("keeps Survey and Remedial defaults separate", () => {
    const projectInput = createSurveyProjectInput("EUR", "km");
    expect(projectInput.costingModule).toBe("survey");
    expect(projectInput.includeGrinding).toBe(false);
    expect(projectInput.includeScreeding).toBe(false);
    expect(projectInput.includeRepairs).toBe(false);
  });

  it("serialises and reloads a Survey rate/input snapshot without becoming Remedial", () => {
    const inputs = createSurveyProjectInput("EUR", "km", inHouseSurvey());
    const calculations = calculateSurveyProject(inputs.survey!, defaultSurveyRates);
    const project: ProjectRecord = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", companyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", createdAt: "2026-08-19T00:00:00.000Z", status: "Draft", accountsStatus: "Not Required", inputs, calculations, rateSnapshot: { ...defaultRates, surveyRates: defaultSurveyRates }, revisions: [], notes: [], changeLog: [], timeEntries: [{ id: "time-1", projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", date: "2026-08-19", person: "Tester", role: "Surveyor", workType: "Survey", hours: 8, rate: 50, approved: false, notes: "Trial", createdAt: "2026-08-19T12:00:00.000Z" }] };
    const row = projectToRow(project, "cccccccc-cccc-cccc-cccc-cccccccccccc");
    const reopened = rowToProject(row);
    expect(reopened.inputs.costingModule).toBe("survey");
    expect(reopened.inputs.survey?.autoStoreArea).toBe(6500);
    expect(reopened.rateSnapshot?.surveyRates?.surveyorBudgetDayRate).toBe(550);
    expect(reopened.calculations.costingModule).toBe("survey");
    expect(reopened.calculations.mobilisationRate).toBe(calculations.mobilisationRate);
    expect(reopened.timeEntries?.[0].workType).toBe("Survey");
  });

  it("shows separate Surveyor, Project Manager and Labourer P&L rows rolled into Labour", () => {
    const calculations = calculateSurveyProject({ ...inHouseSurvey(), projectManagerRequired: true, labourerRequired: true, numberOfLabourers: 1 }, defaultSurveyRates);
    const actuals = { ...defaultActuals(calculations), surveyorInternal: 4000, projectManagerInternal: 2000, labourerInternal: 1000 };
    const summary = calculatePL(calculations, actuals);
    expect(summary.rows.find((row) => row.item === "Surveyor")?.actual).toBe(4000);
    expect(summary.rows.find((row) => row.item === "Project Manager")?.actual).toBe(2000);
    expect(summary.rows.find((row) => row.item === "Labourer")?.actual).toBe(1000);
    expect(summary.actualCost).toBeGreaterThanOrEqual(7000);
  });

  it("gives the first two companies both module-compatible distance defaults", () => {
    expect(defaultCompanies.find((company) => company.name === "CoGri Group")?.distanceUnit).toBe("miles");
    expect(defaultCompanies.find((company) => company.name === "Face GmbH")?.distanceUnit).toBe("km");
  });
});
