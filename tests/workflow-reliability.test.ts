import { describe, expect, it } from "vitest";
import { adjacentBuilderStep, parseEditRoute, resolveBuilderStep, visibleBuilderSteps } from "@/lib/builder";
import { calculatePL, calculateProject, defaultActuals } from "@/lib/calculations";
import { defaultRepairCatalog, materialById, validateRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput } from "@/lib/rates";
import { projectToRow, rowToProject } from "@/lib/storage";
import type { ProjectRecord } from "@/lib/types";

describe("rollout workflow reliability", () => {
  it("keeps one ordered builder path and skips unselected services", () => {
    const input = { ...emptyInput, includeGrinding: true, grinding: { ...emptyInput.grinding, enabled: true }, uiProgress: { ...emptyInput.uiProgress, builderStep: "Project" } };
    expect(visibleBuilderSteps(input)).toEqual(["Services", "Project", "Grinding", "Project Management", "Extras", "Review"]);
    expect(resolveBuilderStep(input)).toBe("Project");
    expect(adjacentBuilderStep(input, 1)).toBe("Grinding");
    expect(adjacentBuilderStep({ ...input, uiProgress: { ...input.uiProgress, builderStep: "Grinding" } }, 1)).toBe("Project Management");
  });

  it("falls back safely if a saved step is no longer selected", () => {
    const input = { ...emptyInput, uiProgress: { ...emptyInput.uiProgress, builderStep: "Repairs" } };
    expect(resolveBuilderStep(input)).toBe("Services");
  });

  it("parses a saved-project continuation route including service and revision", () => {
    expect(parseEditRoute("/new-project/project%201/repairs/revision")).toEqual({ projectId: "project 1", step: "Repairs", createsRevision: true });
    expect(parseEditRoute("/new-project/abc")).toEqual({ projectId: "abc", step: undefined, createsRevision: false });
  });

  it("round-trips the exact draft rate and catalogue snapshots through the project row", () => {
    const rates = { ...defaultRates, productionLabourDayRate: 777 };
    const calculations = calculateProject(emptyInput, rates, defaultRepairCatalog);
    const project: ProjectRecord = {
      id: "draft-1",
      companyId: "company-1",
      createdAt: "2026-08-12T00:00:00.000Z",
      status: "Draft",
      accountsStatus: "Not Required",
      inputs: emptyInput,
      calculations,
      rateSnapshot: rates,
      repairCatalogSnapshot: defaultRepairCatalog,
      calculationVersion: "5.0",
      revisions: []
    };
    const row = projectToRow(project, "00000000-0000-0000-0000-000000000001");
    const restored = rowToProject({ ...row, created_at: project.createdAt });
    expect(restored.rateSnapshot?.productionLabourDayRate).toBe(777);
    expect(restored.repairCatalogSnapshot?.types.length).toBe(defaultRepairCatalog.types.length);
    expect(restored.calculationVersion).toBe("5.0");
    expect((restored.inputs as unknown as Record<string, unknown>).__costingSnapshot).toBeUndefined();
  });

  it("maps legacy shared rates into new service-specific snapshot fields", () => {
    const legacyRates = {
      ...defaultRates,
      grindingSurveyorDayRate: undefined,
      screedSurveyorDayRate: undefined,
      grindingHotelNightRate: undefined,
      screedHotelNightRate: undefined,
      surveyorDayRate: 777,
      hotel: 123,
      rateMargins: { surveyorDayRate: 0.11, hotel: 0.22 }
    };
    const restored = rowToProject({
      id: "legacy-project",
      created_at: "2026-08-12T00:00:00.000Z",
      status: "Draft",
      accounts_status: "Not Required",
      inputs: { ...emptyInput, __costingSnapshot: { rates: legacyRates } },
      calculations: calculateProject(emptyInput, defaultRates),
      revisions: []
    });
    expect(restored.rateSnapshot?.grindingSurveyorDayRate).toBe(777);
    expect(restored.rateSnapshot?.screedSurveyorDayRate).toBe(777);
    expect(restored.rateSnapshot?.grindingHotelNightRate).toBe(123);
    expect(restored.rateSnapshot?.screedHotelNightRate).toBe(123);
    expect(restored.rateSnapshot?.rateMargins?.grindingSurveyorDayRate).toBe(0.11);
    expect(restored.rateSnapshot?.rateMargins?.screedHotelNightRate).toBe(0.22);
  });

  it("starts P&L site days in automatic mode", () => {
    const actuals = defaultActuals(calculateProject(emptyInput, defaultRates));
    expect(actuals.daysTakenToComplete).toBe(0);
    expect(actuals.siteDaysOverridden).toBe(false);
  });

  it("allows survey actuals to be explicitly cleared to zero", () => {
    const calculations = calculateProject(emptyInput, defaultRates);
    const actuals = { ...defaultActuals(calculations), labourInternalDays: 5, labourInternalRate: 100, surveyDays: 0, surveyDayRate: 0 };
    const survey = calculatePL(calculations, actuals).rows.find((row) => row.item === "Survey Days");
    expect(survey?.actual).toBe(0);
  });

  it("uses one consistent fallback when an old record contains a zero exchange rate", () => {
    const result = calculateProject({ ...emptyInput, exchangeRateToCompanyCurrency: 0, exchangeRateToGroupCurrency: 0 }, defaultRates);
    expect(result.proposalCompanyCurrency).toBe(result.proposalTotal);
    expect(result.budgetGroupCurrency).toBe(result.budgetCost);
  });

  it("rejects duplicate repair codes and inactive materials assigned to active types", () => {
    const firstType = defaultRepairCatalog.types.find((type) => type.active)!;
    const activeMaterial = defaultRepairCatalog.materials.find((material) => material.id === firstType.materialRules[0].materialId)!;
    const catalog = {
      materials: defaultRepairCatalog.materials.map((material) => material.id === activeMaterial.id ? { ...material, active: false } : material),
      types: [{ ...firstType, code: "DUP" }, { ...firstType, code: "dup" }]
    };
    const validation = validateRepairCatalog(catalog);
    expect(validation.duplicateCodes).toEqual(["dup"]);
    expect(validation.invalidTypes.length).toBeGreaterThan(0);
    expect(materialById(activeMaterial.id, catalog)).toBeUndefined();
  });
});
