import { describe, expect, it } from "vitest";
import { calculatePL, calculateProject, defaultActuals } from "@/lib/calculations";
import { calculateSurveyProject } from "@/lib/costing/survey/calculations";
import { createEmptySurveyInput, defaultSurveyRates } from "@/lib/costing/survey/defaults";
import { visibleBuilderSteps } from "@/lib/builder";
import { createRepairLine } from "@/lib/repairCatalog";
import { defaultRates, emptyInput } from "@/lib/rates";
import { projectToRow, rowToProject } from "@/lib/storage";
import { projectCsv } from "@/lib/export";
import { createWorkPackage } from "@/lib/workPackages";
import type { ProjectInput, ProjectRecord, RemedialWorkPackage, RepairCatalog, RepairSubcontractor } from "@/lib/types";

function subcontractor(name: string, rate: number, days: number, margin = 0.3): RepairSubcontractor {
  return { name, priceType: "day", rate, days, margin, mobilisationCost: 0, mobilisations: 0, mobilisationMargin: 0.3, standbyRate: 0, standbyMargin: margin };
}

function grindingPackage(parent: ProjectInput, index: number, name: string): RemedialWorkPackage {
  const item = createWorkPackage("Grinding", parent, index);
  return {
    ...item,
    name,
    grinding: {
      ...item.grinding!,
      enabled: true,
      estimatedDays: 2,
      productionLabourMode: "subcontract",
      productionSubcontractors: [subcontractor(`${name} production`, 100, 2)],
      surveyorLabourMode: "subcontract",
      surveyorSubcontractors: [{ ...subcontractor(`${name} surveyor`, 50, 0), priceType: "lump sum" }]
    }
  };
}

function selectableBase(): ProjectInput {
  return {
    ...emptyInput,
    projectReference: "PKG-001",
    client: "Package Client",
    location: "Berlin",
    pricingMode: "selectable",
    selectionConfirmed: false,
    sharedCosts: [{ name: "Common mobilisation", rate: 100, unit: "item", quantity: 1, margin: 0.2, plCategory: "Travel" }],
    workPackages: [],
    activeWorkPackageId: ""
  };
}

describe("selectable remedial work packages", () => {
  it("keeps the existing combined project path unchanged", () => {
    const result = calculateProject(emptyInput, defaultRates);
    expect(result.pricingMode).toBeUndefined();
    expect(result.proposalTotal).toBe(0);
    expect(visibleBuilderSteps(emptyInput)).toEqual(["Services", "Project", "Project Management", "Extras", "Review"]);
    const selectable = selectableBase();
    const onePackage = grindingPackage(selectable, 0, "Only package");
    expect(visibleBuilderSteps({ ...selectable, workPackages: [onePackage] })).toEqual(["Services", "Project", "Packages", "Project Management", "Extras", "Review"]);
    expect(visibleBuilderSteps({ ...selectable, workPackages: [onePackage, grindingPackage(selectable, 1, "Second package")] })).toContain("Phase Schedule");
  });

  it("charges common costs once and shows offered and selected values separately", () => {
    const parent = selectableBase();
    const first = grindingPackage(parent, 0, "Area one");
    const second = { ...grindingPackage(parent, 1, "Area two"), selected: false };
    const unconfirmed = calculateProject({ ...parent, workPackages: [first, second], activeWorkPackageId: first.id }, defaultRates);
    expect(unconfirmed.packageSummaries).toHaveLength(2);
    expect(unconfirmed.commonProposalTotal).toBe(120);
    expect(unconfirmed.allOptionsProposalTotal).toBe(770);
    expect(unconfirmed.proposalTotal).toBe(770);

    const confirmed = calculateProject({ ...parent, selectionConfirmed: true, workPackages: [first, second], activeWorkPackageId: first.id }, defaultRates);
    expect(confirmed.selectedProposalTotal).toBe(445);
    expect(confirmed.proposalTotal).toBe(445);
    expect(confirmed.budgetCost).toBe(350);
    expect(confirmed.proposalLines.filter((line) => line.commercialGroup === "common")).toHaveLength(1);
    expect(confirmed.proposalLines.some((line) => line.workPackageId === second.id)).toBe(false);
  });

  it("does not activate common costs when a confirmed project has no selected package", () => {
    const parent = selectableBase();
    const declined = { ...grindingPackage(parent, 0, "Declined"), selected: false };
    const result = calculateProject({ ...parent, selectionConfirmed: true, workPackages: [declined] }, defaultRates);
    expect(result.proposalTotal).toBe(0);
    expect(result.budgetCost).toBe(0);
  });

  it("removes internal travel-day labour from shared mobilisation but retains it for a separate mobilisation", () => {
    const parent = selectableBase();
    const item = createWorkPackage("Grinding", parent, 0);
    const packageWithTravel = {
      ...item,
      grinding: {
        ...item.grinding!,
        estimatedDays: 2,
        productionLabourMode: "in_house" as const,
        productionMen: 1,
        productionLabourDays: 2,
        productionTravelMode: "Drive" as const,
        productionTravelDays: 2,
        productionVehicles: 1,
        productionOneWayKm: 100,
        surveyorLabourMode: "in_house" as const,
        surveyorCount: 1,
        surveyorDays: 2,
        surveyorTravelMode: "Drive" as const,
        surveyorTravelDays: 2,
        surveyorVehicles: 1,
        surveyorOneWayKm: 100
      }
    };
    const shared = calculateProject({ ...parent, sharedCosts: [], workPackages: [{ ...packageWithTravel, mobilisationMode: "shared" as const }] }, defaultRates);
    const separate = calculateProject({ ...parent, sharedCosts: [], workPackages: [{ ...packageWithTravel, mobilisationMode: "separate" as const }] }, defaultRates);
    expect(shared.proposalLines.filter((line) => /travel/i.test(line.item) && line.total > 0)).toHaveLength(0);
    expect(separate.proposalLines.some((line) => /travel/i.test(line.item) && line.total > 0)).toBe(true);
    expect(separate.proposalTotal).toBeGreaterThan(shared.proposalTotal);
  });

  it("supports overlapping package phases without adding their durations together", () => {
    const parent = selectableBase();
    const first = { ...grindingPackage(parent, 0, "Area one"), startDay: 1, grinding: { ...grindingPackage(parent, 0, "Area one").grinding!, estimatedDays: 5 } };
    const second = { ...grindingPackage(parent, 1, "Area two"), startDay: 3, grinding: { ...grindingPackage(parent, 1, "Area two").grinding!, estimatedDays: 5 } };
    const result = calculateProject({ ...parent, workPackages: [first, second] }, defaultRates);
    expect(result.siteDays).toBe(7);
    expect(result.phaseRows.every((row) => row.concurrent)).toBe(true);
  });

  it("keeps package repair prices standalone but consolidates selected procurement before rounding", () => {
    const catalog: RepairCatalog = {
      materials: [{ id: "unit-material", name: "Unit Material", category: "Other", unitType: "each", unitSize: 1, costPerUnit: 100, calcMethod: "each", measuredUnitType: "each", coveragePerUnit: 1, wasteFactor: 1, sourceNote: "Test", active: true, notes: "" }],
      types: [{ id: "unit-type", code: "Type Unit", name: "Unit Repair", measurementBasis: "each", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 10, description: "", materialRules: [{ materialId: "unit-material", role: "required", defaultSelected: true }], active: true }]
    };
    const parent = selectableBase();
    const makeRepairPackage = (index: number) => {
      const item = createWorkPackage("Repairs", parent, index);
      return { ...item, repairs: { ...item.repairs!, labourMode: "subcontract" as const, repairLines: [{ ...createRepairLine("Type Unit", catalog), eachQty: 0.4 }] } };
    };
    const packages = [makeRepairPackage(0), makeRepairPackage(1)];
    const result = calculateProject({ ...parent, selectionConfirmed: true, sharedCosts: [], workPackages: packages }, defaultRates, catalog);
    expect(result.packageSummaries?.map((item) => item.budgetCost)).toEqual([100, 100]);
    expect(result.repairMaterialCalcs[0].unroundedUnits).toBeCloseTo(0.8, 8);
    expect(result.repairMaterialCalcs[0].quantity).toBe(1);
    expect(result.budgetLines.filter((line) => line.plCategory === "Materials").reduce((sum, line) => sum + line.total, 0)).toBe(100);
    expect(result.proposalTotal).toBe(260);
  });

  it("calculates grinding stand-down from people, stay and transport but never equipment", () => {
    const parent = selectableBase();
    const item = createWorkPackage("Grinding", parent, 0);
    const workPackage: RemedialWorkPackage = {
      ...item,
      pricingBasis: "day_rate",
      expectedStandDownDays: 2,
      grinding: {
        ...item.grinding!,
        estimatedDays: 2,
        productionLabourMode: "in_house",
        productionMen: 2,
        productionLabourDays: 2,
        productionTravelMode: "None",
        surveyorLabourMode: "in_house",
        surveyorCount: 1,
        surveyorDays: 2,
        surveyorTravelMode: "None",
        generatorRequired: true,
        generatorCount: 1
      }
    };
    const result = calculateProject({ ...parent, sharedCosts: [], workPackages: [workPackage] }, defaultRates);
    const schedule = result.rateSchedules![0];
    expect(schedule.standbyBudgetRate).toBe(1400);
    expect(schedule.standbyProposalRate).toBe(1760);
    expect(result.budgetLines.filter((line) => /stand-down/i.test(line.item)).reduce((sum, line) => sum + line.total, 0)).toBe(2800);
    expect(result.proposalLines.some((line) => /stand-down/i.test(line.item) && line.plCategory === "Equipment")).toBe(false);
  });

  it("marks supplier stand-down up and preserves explicit commercial overrides", () => {
    const parent = selectableBase();
    const item = createWorkPackage("Grinding", parent, 0);
    const workPackage: RemedialWorkPackage = {
      ...item,
      pricingBasis: "day_rate",
      expectedStandDownDays: 2,
      productiveRateOverride: 2500,
      standbyRateOverride: 700,
      rateOverrideReason: "Agreed client schedule",
      grinding: {
        ...item.grinding!,
        estimatedDays: 2,
        productionLabourMode: "subcontract",
        productionSubcontractors: [{ ...subcontractor("Production supplier", 1000, 2), standbyRate: 400, standbyMargin: 0.25 }],
        surveyorLabourMode: "subcontract",
        surveyorSubcontractors: [{ ...subcontractor("Survey supplier", 200, 2), standbyRate: 100, standbyMargin: 0.3 }]
      }
    };
    const result = calculateProject({ ...parent, sharedCosts: [], workPackages: [workPackage] }, defaultRates);
    const schedule = result.rateSchedules![0];
    expect(schedule.productiveProposalRate).toBe(2500);
    expect(schedule.standbyBudgetRate).toBe(500);
    expect(schedule.standbyProposalRate).toBe(700);
    expect(schedule.overrideReason).toBe("Agreed client schedule");
    expect(result.proposalLines.find((line) => line.item === "Stand-down day rate adjustment")).toBeTruthy();
  });

  it("round-trips selectable project inputs and calculation snapshots", () => {
    const parent = selectableBase();
    const workPackage = grindingPackage(parent, 0, "Saved package");
    const inputs = { ...parent, workPackages: [workPackage], activeWorkPackageId: workPackage.id };
    const calculations = calculateProject(inputs, defaultRates);
    const project: ProjectRecord = { id: "project-1", companyId: "company-1", createdAt: "2026-08-30T00:00:00.000Z", status: "Draft", accountsStatus: "Not Required", inputs, calculations, rateSnapshot: defaultRates, repairCatalogSnapshot: catalogForRecord(), calculationVersion: "remedial-6.0", revisions: [] };
    const reopened = rowToProject(projectToRow(project, "user-1"));
    expect(reopened.inputs.pricingMode).toBe("selectable");
    expect(reopened.inputs.workPackages[0].name).toBe("Saved package");
    expect(reopened.calculations.proposalTotal).toBe(calculations.proposalTotal);
  });

  it("reconciles the selected package budget into every P&L category and overall total", () => {
    const parent = selectableBase();
    const selected = grindingPackage(parent, 0, "Selected package");
    const declined = { ...grindingPackage(parent, 1, "Declined package"), selected: false };
    const result = calculateProject({ ...parent, selectionConfirmed: true, workPackages: [selected, declined] }, defaultRates);
    const summary = calculatePL(result, defaultActuals(result));
    const displayedBudget = summary.rows.reduce((sum, row) => sum + row.budget, 0);
    expect(displayedBudget).toBe(result.budgetCost);
    expect(summary.rows.find((row) => row.item === "Labour Subcontract")?.budget).toBe(250);
    expect(summary.rows.find((row) => row.item === "Travel")?.budget).toBe(100);
    const project = { id: "export-1", companyId: "company-1", createdAt: "2026-08-30T00:00:00.000Z", status: "Draft" as const, accountsStatus: "Not Required" as const, inputs: { ...parent, selectionConfirmed: true, workPackages: [selected, declined] }, calculations: result, revisions: [] };
    const csv = projectCsv(project);
    expect(csv).toContain("Commercial offer");
    expect(csv).toContain("Selected execution budget");
    expect(csv).toContain("Not selected");
  });
});

function catalogForRecord(): RepairCatalog {
  return { materials: [], types: [] };
}

describe("survey commercial rate schedules", () => {
  it("calculates subcontract productive, mobilisation and stand-down rates independently", () => {
    const input = {
      ...createEmptySurveyInput("EUR", "km"),
      surveyType: "AutoStore" as const,
      autoStoreArea: 3000,
      surveyorSupply: "Subcontracted" as const,
      pricingBasis: "day_rate" as const,
      subcontractSurveyCost: 1000,
      subcontractSurveyMarkup: 0.3,
      subcontractMobilisationCost: 500,
      subcontractMobilisationMarkup: 0.2,
      subcontractStandbyCost: 400,
      subcontractStandbyMarkup: 0.25,
      expectedStandDownDays: 2
    };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    const schedule = result.rateSchedules![0];
    expect(result.siteDays).toBe(3);
    expect(schedule.productiveProposalRate).toBe(1300);
    expect(schedule.mobilisationProposal).toBe(600);
    expect(schedule.standbyProposalRate).toBe(500);
    expect(result.proposalTotal).toBe(5500);
    expect(result.budgetCost).toBe(4300);
  });

  it("excludes survey equipment from in-house stand-down", () => {
    const input = {
      ...createEmptySurveyInput("EUR", "km"),
      surveyType: "AutoStore" as const,
      autoStoreArea: 1000,
      surveyorsOnSite: 1,
      numberOfProfs: 2,
      pricingBasis: "day_rate" as const,
      expectedStandDownDays: 1
    };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.rateSchedules?.[0].standbyBudgetRate).toBe(defaultSurveyRates.standbySurveyorBudgetDayRate);
    expect(result.proposalLines.some((line) => /stand-down/i.test(line.item) && line.plCategory === "Equipment")).toBe(false);
  });
});
