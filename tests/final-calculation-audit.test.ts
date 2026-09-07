import { describe, expect, it } from "vitest";
import { calculatePL, calculateProject, defaultActuals } from "@/lib/calculations";
import { createEmptySurveyInput, defaultSurveyRates } from "@/lib/costing/survey/defaults";
import { calculateSurveyProject } from "@/lib/costing/survey/calculations";
import { createRepairLine, defaultRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput, validationInput } from "@/lib/rates";
import type { PLCategory, ProjectCalculations, RepairCatalog, RepairLineItem } from "@/lib/types";

const budgetFor = (result: ProjectCalculations, category: PLCategory) => result.budgetLines
  .filter((line) => line.plCategory === category)
  .reduce((total, line) => total + line.total, 0);

function repairProject(repairLine: RepairLineItem, catalog: RepairCatalog = defaultRepairCatalog, labourDays = 0) {
  return calculateProject({
    ...emptyInput,
    includeRepairs: true,
    repairs: {
      ...emptyInput.repairs,
      enabled: true,
      labourMode: "in_house",
      labourMen: 1,
      labourDays,
      repairLines: [repairLine],
      repairSubcontractors: [],
      haulageItems: [],
      travelMode: "None"
    }
  }, defaultRates, catalog);
}

function expectCommercials(result: ProjectCalculations, expected: {
  budget: number;
  proposal: number;
  markup: number;
  labour: number;
  materials: number;
  subcontract?: number;
  mobilisation?: number;
  standby?: number;
  days: number;
}) {
  expect(result.budgetCost).toBe(expected.budget);
  expect(result.proposalTotal).toBe(expected.proposal);
  expect(result.budgetMarkup).toBe(expected.markup);
  expect(budgetFor(result, "Labour")).toBe(expected.labour);
  expect(budgetFor(result, "Materials")).toBe(expected.materials);
  expect(budgetFor(result, "Subcontract")).toBe(expected.subcontract ?? 0);
  expect(result.budgetLines.filter((line) => line.costKind === "mobilisation").reduce((total, line) => total + line.total, 0)).toBe(expected.mobilisation ?? 0);
  expect(result.budgetLines.filter((line) => line.costKind === "stand_down").reduce((total, line) => total + line.total, 0)).toBe(expected.standby ?? 0);
  expect(result.siteDays).toBe(expected.days);
  expect(calculatePL(result, defaultActuals(result)).rows.reduce((total, row) => total + row.budget, 0)).toBe(result.budgetCost);
}

describe("focused final calculation audit", () => {
  it("1. prices a repair with default materials only", () => {
    const line = { ...createRepairLine("Type 1", defaultRepairCatalog), lengthM: 10, widthMm: 8, depthMm: 30 };
    const result = repairProject(line);
    expect(result.repairMaterialCalcs.map((material) => [material.materialId, material.quantity])).toEqual([["lv-rapid-600", 5]]);
    expectCommercials(result, { budget: 565, proposal: 688.5, markup: 21.86, labour: 460, materials: 105, days: 1 });
  });

  it("2. removes a default and prices an added eligible optional material", () => {
    const base = { ...createRepairLine("Type 1", defaultRepairCatalog), lengthM: 10, widthMm: 8, depthMm: 30 };
    const line = {
      ...base,
      materialSelections: base.materialSelections.map((selection) => selection.materialId === "lv-rapid-600"
        ? { ...selection, selected: false }
        : selection.materialId === "rapid-seal-600" ? { ...selection, selected: true } : selection)
    };
    const result = repairProject(line);
    expect(result.repairMaterialCalcs.map((material) => [material.materialId, material.quantity])).toEqual([["rapid-seal-600", 5]]);
    expectCommercials(result, { budget: 550, proposal: 669, markup: 21.64, labour: 460, materials: 90, days: 1 });
  });

  it("3. prices Type 3 mortar from repair dimensions and sealant from its own operation dimensions", () => {
    const line = { ...createRepairLine("Type 3", defaultRepairCatalog), lengthM: 60, widthMm: 60, depthMm: 70 };
    const result = repairProject(line);
    expect(result.repairMaterialCalcs.map((material) => [material.materialId, material.quantity])).toEqual([
      ["rapid-mender", 31],
      ["rapid-seal-600", 11]
    ]);
    expectCommercials(result, { budget: 4375.75, proposal: 5550.48, markup: 26.85, labour: 1380, materials: 2995.75, days: 3 });
  });

  it("4. prices bolt removal from cylindrical core volume", () => {
    const line = { ...createRepairLine("Type 5a", defaultRepairCatalog), eachQty: 100, holeDiameterMm: 30, holeDepthMm: 30 };
    const result = repairProject(line);
    expect(result.repairMaterialCalcs.map((material) => [material.materialId, material.quantity])).toEqual([["lv-rapid-600", 4]]);
    expectCommercials(result, { budget: 1004, proposal: 1213.2, markup: 20.84, labour: 920, materials: 84, days: 2 });
  });

  it("5. preserves zero output per day and uses manual project days", () => {
    const catalog: RepairCatalog = {
      materials: [{ id: "zero-output-material", name: "Zero Output Material", category: "Other", unitType: "each", unitSize: 1, costPerUnit: 10, calcMethod: "each", measuredUnitType: "each", coveragePerUnit: 1, wasteFactor: 1, sourceNote: "Audit", active: true, notes: "" }],
      types: [{ code: "Zero Output", name: "Zero Output Repair", measurementBasis: "each", defaultWidthMm: 0, defaultDepthMm: 0, defaultThicknessMm: 0, defaultOutputPerDay: 0, description: "", materialRules: [{ materialId: "zero-output-material", role: "required", defaultSelected: true }], active: true }]
    };
    const line = { ...createRepairLine("Zero Output", catalog), eachQty: 4 };
    const result = repairProject(line, catalog, 3);
    expect(result.repairMaterialCalcs.map((material) => [material.materialId, material.quantity])).toEqual([["zero-output-material", 4]]);
    expect(result.repairPricing?.[0].rows[0].labourBudget).toBe(1380);
    expect(result.repairPricing?.[0].unallocatedBudget).toBe(0);
    expectCommercials(result, { budget: 1420, proposal: 1708, markup: 20.28, labour: 1380, materials: 40, days: 3 });
  });

  it("6. rounds a positive survey requirement below one day up to one site day", () => {
    const input = { ...createEmptySurveyInput("EUR", "km"), surveyType: "AutoStore" as const, autoStoreArea: 500, surveyorsOnSite: 1 };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.survey?.calculatedDayRequirement).toBe(0.5);
    expect(result.survey?.calculatedSiteDays).toBe(1);
    expectCommercials(result, { budget: 550, proposal: 1200, markup: 118.18, labour: 550, materials: 0, days: 1 });
  });

  it("7. uses an entered survey-day override while retaining the calculated guide", () => {
    const input = { ...createEmptySurveyInput("EUR", "km"), surveyType: "AutoStore" as const, autoStoreArea: 1200, surveyorsOnSite: 1, siteDaysOverride: 1 };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.survey?.calculatedDayRequirement).toBe(1.2);
    expect(result.survey?.calculatedSiteDays).toBe(2);
    expect(result.survey?.siteDaysOverridden).toBe(true);
    expectCommercials(result, { budget: 550, proposal: 1200, markup: 118.18, labour: 550, materials: 0, days: 1 });
  });

  it("8. prices a subcontract survey as a Fixed Lump Sum package", () => {
    const input = {
      ...createEmptySurveyInput("EUR", "km"), surveyType: "AutoStore" as const, autoStoreArea: 3000,
      surveyorSupply: "Subcontracted" as const, subcontractSurveyCost: 3000, subcontractSurveyMarkup: 0.3,
      subcontractStandbyCost: 400, subcontractStandbyMarkup: 0.25, pricingBasis: "fixed" as const
    };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.dailyRate).toBe(1300);
    expect(result.mobilisationRate).toBe(0);
    expect(result.standbyRate).toBe(500);
    expectCommercials(result, { budget: 3000, proposal: 3900, markup: 30, labour: 0, materials: 0, subcontract: 3000, days: 3 });
  });

  it("9. prices productive, mobilisation and stand-down components for a Day Rate survey", () => {
    const input = {
      ...createEmptySurveyInput("EUR", "km"), surveyType: "AutoStore" as const, autoStoreArea: 3000,
      surveyorSupply: "Subcontracted" as const, subcontractSurveyCost: 1000, subcontractSurveyMarkup: 0.3,
      subcontractMobilisationCost: 500, subcontractMobilisationMarkup: 0.2,
      subcontractStandbyCost: 400, subcontractStandbyMarkup: 0.25,
      pricingBasis: "day_rate" as const, expectedStandDownDays: 2
    };
    const result = calculateSurveyProject(input, defaultSurveyRates);
    expect(result.dailyRate).toBe(1300);
    expect(result.mobilisationRate).toBe(600);
    expect(result.standbyRate).toBe(500);
    expectCommercials(result, { budget: 4300, proposal: 5500, markup: 27.91, labour: 0, materials: 0, subcontract: 4300, mobilisation: 500, standby: 800, days: 3 });
  });

  it("10. preserves the established combined remedial validation totals", () => {
    const result = calculateProject(validationInput, defaultRates);
    expect(result.grindingDays).toBe(5);
    expect(result.screedDays).toBe(4);
    expect(result.repairDays).toBe(3);
    expect(result.siteDays).toBe(12);
    expect(result.proposalTotal).toBe(69261.15);
    expect(result.budgetCost).toBe(61650.75);
    expect(result.budgetMarkup).toBe(12.34);
    expect(result.discountAmount).toBe(3645.32);
    expect(Object.fromEntries((["Labour", "Subcontract", "Materials", "Equipment", "Travel", "Hotel/Subsistence", "Haulage"] as PLCategory[]).map((category) => [category, budgetFor(result, category)]))).toEqual({
      Labour: 21500,
      Subcontract: 21150,
      Materials: 10120.75,
      Equipment: 1050,
      Travel: 0,
      "Hotel/Subsistence": 7755,
      Haulage: 75
    });
    expect(result.budgetLines.reduce((total, line) => total + line.total, 0)).toBe(result.budgetCost);
    expect(calculatePL(result, defaultActuals(result)).rows.reduce((total, row) => total + row.budget, 0)).toBe(result.budgetCost);
  });
});
