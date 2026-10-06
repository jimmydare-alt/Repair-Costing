import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculateQaProgrammeDefaults, calculateQaProject } from "@/lib/costing/qa/calculations";
import { calculateIntegratedQaProject, selectIntegratedQaPackages } from "@/lib/costing/qa/combined";
import { createEmptyQaInput, defaultQaRates, normaliseQaInput } from "@/lib/costing/qa/defaults";
import { createQaProjectInput } from "@/lib/costing/qa/project";
import { createEmptySurveyInput, defaultSurveyRates } from "@/lib/costing/survey/defaults";
import { defaultRates } from "@/lib/rates";
import { projectToRow, rowToProject } from "@/lib/storage";
import type { ProjectRecord } from "@/lib/types";

function qaInput() {
  const input = createEmptyQaInput("EUR", "km");
  input.projectReference = "QA-001";
  input.client = "Example Client";
  input.location = "Madrid";
  input.programme = null;
  input.areas[0] = {
    ...input.areas[0],
    name: "Warehouse A",
    areaM2: 12000,
    guidedSchedule: false,
    quantities: {
      internalOfficeWork: 1,
      internalMeeting: 2,
      internalSupervisionDay: 4,
      internalTravelDay: 2,
      internalHotelNight: 4,
      internalDistance: 600
    }
  };
  return input;
}

describe("separate QA costing module", () => {
  it("registers QA disabled by default and enables it only for Eurostick/CGFE", () => {
    const sql = readFileSync("supabase/migrations/015_qa_costing_module.sql", "utf8");
    expect(sql).toContain("'qa_costing'");
    expect(sql).toContain("module.id, false");
    expect(sql).toContain("lower(company.name) like 'eurostick%'");
    expect(sql).toContain("lower(company.name) like '%cgfe%'");
  });

  it("starts with no design or supervision cost until hours or days are entered", () => {
    const result = calculateQaProject(createEmptyQaInput("EUR", "km"), defaultQaRates);
    expect(result.proposalTotal).toBe(0);
    expect(result.budgetCost).toBe(0);
    expect(result.siteDays).toBe(0);
    expect(result.qa.designReviewBudget).toBe(0);
    expect(result.qa.supervisionBudget).toBe(0);
  });

  it("treats a missing programme override map from an older open draft as empty", () => {
    const input = createEmptyQaInput("EUR", "km");
    input.programme = { ...input.programme!, siteDays: 2, rateOverrides: undefined } as unknown as NonNullable<typeof input.programme>;
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.qa.supervisionBudget).toBe(1360);
    expect(result.qa.overrideCount).toBe(0);
  });

  it("keeps Design Review and Site Supervision as separate prices", () => {
    const result = calculateQaProject(qaInput(), defaultQaRates);
    expect(result.qa.designReviewBudget).toBe(6800);
    expect(result.qa.supervisionBudget).toBe(2720);
    expect(result.qa.travelBudget).toBe(2100);
    expect(result.qa.areas[0].supervisionDays).toBe(4);
    expect(result.qa.areas[0].productivityM2PerDay).toBe(3000);
    expect(result.rateSchedules?.map((item) => item.service)).toEqual(["QA", "QA"]);
  });

  it("prices new design reviews and meetings from senior engineer hours", () => {
    const input = createEmptyQaInput("EUR", "km");
    input.siteSupervisionIncluded = false;
    input.areas[0].quantities = { internalDesignReviewHour: 8, internalDesignMeetingHour: 2 };
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.qa.designReviewBudget).toBe(600);
    expect(result.proposalLines.find((line) => line.item.includes("Design Review"))?.quantity).toBe(8);
    expect(result.proposalLines.find((line) => line.item.includes("Meeting"))?.quantity).toBe(2);
  });

  it("keeps QA-assisted Survey separate without duplicating survey labour or visits", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    qa.surveyDeliveryMode = "qa_assisted";
    qa.visitMode = "shared";
    qa.sharedTravelOwner = "qa";
    qa.qaAssistedAdditionalSurveyDays = 1;
    qa.programme = { ...qa.programme!, siteDays: 5, travelDaysEachWay: 1, oneWayDistance: 100 };
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    survey.primaryOfficeDistanceOneWay = 100;
    survey.selectedTests = [{ testId: "abrasion-resistance", quantity: 2, visitMode: "qa_visit" }];
    const surveyRates = { ...defaultSurveyRates, testCatalog: defaultSurveyRates.testCatalog.map((item) => item.id === "abrasion-resistance" ? { ...item, budgetRate: 100 } : item) };
    const result = calculateIntegratedQaProject(qa, survey, defaultQaRates, surveyRates);
    const surveyLines = result.proposalLines.filter((line) => line.workPackageId === "survey");
    expect(surveyLines.find((line) => line.item === "Surveyor")).toBeUndefined();
    expect(surveyLines.some((line) => line.plCategory === "Travel" || line.plCategory === "Hotel/Subsistence")).toBe(false);
    expect(surveyLines.find((line) => line.item === "Survey Analysis & Reporting")?.cost).toBe(500);
    expect(surveyLines.find((line) => line.item === "Additional QA Engineer Survey Day")?.cost).toBe(680);
    expect(surveyLines.find((line) => line.item === "Test - Abrasion Resistance")?.cost).toBe(200);
    expect(result.packageSummaries?.find((item) => item.id === "survey")?.days).toBe(1);
    expect(result.siteDays).toBe(6);
  });

  it("retains independent Survey costing when QA assistance is not selected", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    const result = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    expect(result.proposalLines.find((line) => line.workPackageId === "survey" && line.item === "Surveyor")?.quantity).toBe(1);
  });

  it("converts QA admin rates into quote currency once and reports company totals", () => {
    const baseline = calculateQaProject(qaInput(), defaultQaRates);
    const converted = calculateQaProject({
      ...qaInput(),
      quoteCurrency: "PLN",
      exchangeRateToCompanyCurrency: 2,
      exchangeRateToGroupCurrency: 3,
      exchangeRateLockedAt: "2026-10-05T09:00:00.000Z"
    }, defaultQaRates);

    expect(converted.budgetCost).toBeCloseTo(baseline.budgetCost / 2, 6);
    expect(converted.proposalTotal).toBeCloseTo(baseline.proposalTotal / 2, 6);
    expect(converted.budgetCompanyCurrency).toBeCloseTo(baseline.budgetCost, 6);
    expect(converted.proposalCompanyCurrency).toBeCloseTo(baseline.proposalTotal, 6);
    expect(converted.proposalGroupCurrency).toBeCloseTo(converted.proposalTotal * 3, 6);
  });

  it("defaults legacy QA exchange rates to one", () => {
    const legacy = createEmptyQaInput("EUR", "km") as Partial<ReturnType<typeof createEmptyQaInput>>;
    delete legacy.exchangeRateToCompanyCurrency;
    delete legacy.exchangeRateToGroupCurrency;
    const normalised = normaliseQaInput(legacy);
    expect(normalised.exchangeRateToCompanyCurrency).toBe(1);
    expect(normalised.exchangeRateToGroupCurrency).toBe(1);
  });

  it("uses only the selected delivery route and keeps subcontract lines in Subcontract P&L", () => {
    const input = qaInput();
    input.areas[0] = {
      ...input.areas[0],
      designDeliveryMode: "subcontract",
      supervisionDeliveryMode: "subcontract",
      quantities: { ...input.areas[0].quantities, subcontractOfficeWork: 1, subcontractSupervisionDay: 3, subcontractTravelDay: 2, subcontractHotelNight: 3 }
    };
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.proposalLines.some((line) => line.item.includes("Internal"))).toBe(false);
    expect(result.proposalLines.every((line) => line.plCategory === "Subcontract")).toBe(true);
    expect(result.qa.areas[0].supervisionDays).toBe(3);
  });

  it("applies and identifies a project rate override without changing admin defaults", () => {
    const input = qaInput();
    input.areas[0].rateOverrides.internalSupervisionDay = { budgetRate: 750, markup: 0.2, reason: "Night access" };
    const result = calculateQaProject(input, defaultQaRates);
    const line = result.proposalLines.find((item) => item.item.endsWith("Internal Supervision Day"));
    expect(line?.cost).toBe(3000);
    expect(line?.total).toBe(3600);
    expect(line?.source).toContain("Night access");
    expect(result.qa.overrideCount).toBe(1);
    expect(defaultQaRates.rates.internalSupervisionDay.budgetRate).toBe(680);
  });

  it("adds repeat visits with their full associated costs", () => {
    const input = qaInput();
    input.areas[0].extraVisits = [{ id: "visit-1", name: "Return inspection", delivery: "internal", people: 2, siteDays: 1, travelDays: 1, hotelNights: 1, subsistenceDays: 1, vehicleDays: 2, oneWayDistance: 100, vehicles: 1, equipmentTransportTrips: 1 }];
    const result = calculateQaProject(input, defaultQaRates);
    const visitLines = result.proposalLines.filter((line) => line.item.includes("Return inspection"));
    expect(visitLines.find((line) => line.item.endsWith("Internal Supervision Day"))?.quantity).toBe(2);
    expect(visitLines.find((line) => line.item.endsWith("Internal Distance"))?.quantity).toBe(200);
    expect(result.qa.areas[0].supervisionDays).toBe(5);
  });

  it("removes QA travel and stay when a linked costing owns shared travel", () => {
    const input = { ...qaInput(), linkedProjectIds: ["survey-1"], sharedTravelOwnerProjectId: "survey-1" };
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.proposalLines.some((line) => line.costKind === "mobilisation")).toBe(false);
    expect(result.mobilisationRate).toBe(0);
    expect(result.qa.designReviewBudget).toBe(6800);
  });

  it("allows a Design Review-only area to carry its own travel without adding supervision", () => {
    const input = qaInput();
    input.areas[0].supervisionRequired = false;
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.qa.supervisionBudget).toBe(0);
    expect(result.qa.travelBudget).toBe(2100);
    expect(result.qa.areas[0].supervisionDays).toBe(0);
    expect(result.mobilisationRate).toBe(2100);
  });

  it("round-trips QA inputs and historical calculations without remedial normalisation", () => {
    const qa = normaliseQaInput(qaInput());
    const inputs = createQaProjectInput("EUR", "km", qa);
    const calculations = calculateQaProject(qa, defaultQaRates);
    const project: ProjectRecord = { id: "qa-project", companyId: "company", createdAt: "2026-09-29T00:00:00.000Z", status: "Draft", accountsStatus: "Not Required", inputs, calculations, rateSnapshot: { ...defaultRates, qaRates: defaultQaRates } };
    const restored = rowToProject(projectToRow(project, "00000000-0000-0000-0000-000000000001"));
    expect(restored.inputs.costingModule).toBe("qa");
    expect(restored.inputs.qa?.areas[0].name).toBe("Warehouse A");
    expect(restored.inputs.survey?.autoStoreArea).toBe(0);
    expect(restored.calculations.proposalTotal).toBe(calculations.proposalTotal);
    expect(restored.calculations.qa?.areas[0].productivityM2PerDay).toBe(3000);
  });

  it("prices embedded Survey and QA independently, then combines them once", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    qa.programme = { ...qa.programme!, siteDays: 2, travelDaysEachWay: 0.5, oneWayDistance: 100 };
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    const combined = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    const packageTotal = combined.packageSummaries?.reduce((sum, item) => sum + item.proposalTotal, 0) ?? 0;
    expect(combined.packageSummaries?.map((item) => item.name)).toEqual(["Survey", "Design Review", "Site Supervision"]);
    expect(combined.proposalTotal).toBe(packageTotal);
    expect(combined.qa?.surveyIncluded).toBe(true);
  });

  it("charges QA travel separately by default and removes it when the visit is shared", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    qa.programme = { ...qa.programme!, siteDays: 3, travelDaysEachWay: 0.5, hotelRequired: true, hotelNightsOverride: 2, oneWayDistance: 100 };
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    const separate = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    const shared = calculateIntegratedQaProject({ ...qa, visitMode: "shared" }, survey, defaultQaRates, defaultSurveyRates);
    expect(separate.siteDays).toBe(4);
    expect(shared.siteDays).toBe(3);
    expect(shared.proposalTotal).toBeLessThan(separate.proposalTotal);
    expect(shared.proposalLines.filter((line) => line.workPackageId === "qa-supervision").some((line) => line.costKind === "mobilisation")).toBe(false);
  });

  it("removes a disabled QA service even when an old area still has it enabled", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.designReviewIncluded = false;
    qa.siteSupervisionIncluded = true;
    qa.programme = { ...qa.programme!, siteDays: 2 };
    const result = calculateIntegratedQaProject(qa, createEmptySurveyInput(), defaultQaRates, defaultSurveyRates);
    expect(result.proposalLines.some((line) => line.item.includes("Office Work"))).toBe(false);
    expect(result.packageSummaries?.map((item) => item.name)).toEqual(["Site Supervision"]);
  });

  it("keeps shared costs once when client package selection is confirmed", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    qa.additionalItems = [{ id: "extra", name: "Independent review", budgetRate: 100, quantity: 1, unit: "item", markup: 0.2, plCategory: "Labour" }];
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    const offered = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    const selected = selectIntegratedQaPackages(offered, ["survey"]);
    expect(selected.selectionConfirmed).toBe(true);
    expect(selected.packageSummaries?.find((item) => item.id === "survey")?.selected).toBe(true);
    expect(selected.packageSummaries?.find((item) => item.id === "qa-design")?.selected).toBe(false);
    expect(selected.proposalLines.some((line) => line.item === "Independent review")).toBe(true);
  });

  it("preserves currency conversions after an integrated package selection", () => {
    const qa = createEmptyQaInput("PLN", "km");
    qa.surveyIncluded = true;
    qa.exchangeRateToCompanyCurrency = 2;
    qa.exchangeRateToGroupCurrency = 3;
    const survey = createEmptySurveyInput("PLN", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    survey.exchangeRateToCompanyCurrency = 2;
    survey.exchangeRateToGroupCurrency = 3;
    const offered = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    const selected = selectIntegratedQaPackages(offered, ["survey"]);
    expect(selected.proposalCompanyCurrency).toBeCloseTo(selected.proposalTotal * 2, 6);
    expect(selected.budgetCompanyCurrency).toBeCloseTo(selected.budgetCost * 2, 6);
    expect(selected.proposalGroupCurrency).toBeCloseTo(selected.proposalTotal * 3, 6);
  });

  it("normalises legacy direct-quantity QA projects without changing their calculation mode", () => {
    const legacy = qaInput();
    delete (legacy.areas[0] as Partial<typeof legacy.areas[0]>).guidedSchedule;
    const normalised = normaliseQaInput(legacy);
    expect(normalised.programme).toBeNull();
    expect(normalised.areas[0].guidedSchedule).toBe(false);
    expect(calculateQaProject(normalised, defaultQaRates).qa.areas[0].supervisionDays).toBe(4);
  });

  it("calculates project-level QA visits, hotel, subsistence and distance", () => {
    const input = createEmptyQaInput("EUR", "km");
    input.programme = {
      ...input.programme!,
      siteDays: 10,
      visits: 2,
      travelDaysEachWay: 1,
      hotelRequired: true,
      oneWayDistance: 150,
      vehicles: 2
    };
    const defaults = calculateQaProgrammeDefaults(input)!;
    expect(defaults.totalTravelDays).toBe(4);
    expect(defaults.calculatedHotelNightsPerPerson).toBe(12);
    expect(defaults.calculatedSubsistenceDaysPerPerson).toBe(14);
    expect(defaults.chargeableDistance).toBe(1200);
    const result = calculateQaProject(input, defaultQaRates);
    expect(result.siteDays).toBe(10);
    expect(result.qa.programme?.visits).toBe(2);
    expect(result.proposalLines.find((line) => line.item === "QA Programme - Internal Distance")?.quantity).toBe(1200);
  });

  it("uses QA hotel and subsistence overrides only when they differ", () => {
    const input = createEmptyQaInput("EUR", "km");
    input.programme = { ...input.programme!, siteDays: 10, visits: 2, travelDaysEachWay: 1, hotelRequired: true, hotelNightsOverride: 11, subsistenceDaysOverride: 13 };
    const defaults = calculateQaProgrammeDefaults(input)!;
    expect(defaults.hotelNightsOverridden).toBe(true);
    expect(defaults.subsistenceDaysOverridden).toBe(true);
    expect(defaults.hotelNightsPerPerson).toBe(11);
    expect(defaults.subsistenceDaysPerPerson).toBe(13);
  });

  it("charges shared visits to QA and reassigns them if only Survey is selected", () => {
    const qa = createEmptyQaInput("EUR", "km");
    qa.surveyIncluded = true;
    qa.visitMode = "shared";
    qa.sharedTravelOwner = "qa";
    qa.programme = { ...qa.programme!, siteDays: 2, visits: 1, travelDaysEachWay: 1, oneWayDistance: 100 };
    const survey = createEmptySurveyInput("EUR", "km");
    survey.autoStoreArea = 1000;
    survey.surveyorsOnSite = 1;
    survey.primaryOfficeDistanceOneWay = 200;
    const offered = calculateIntegratedQaProject(qa, survey, defaultQaRates, defaultSurveyRates);
    expect(offered.proposalLines.filter((line) => line.workPackageId === "survey").some((line) => line.item === "Kilometres")).toBe(false);
    expect(offered.proposalLines.some((line) => line.workPackageId === "qa-supervision" && line.sharedCostForPackageIds?.includes("survey"))).toBe(true);
    const selected = selectIntegratedQaPackages(offered, ["survey"]);
    expect(selected.proposalLines.some((line) => line.workPackageId === "survey" && line.source.includes("reassigned"))).toBe(true);
  });
});
