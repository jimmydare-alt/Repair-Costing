import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allocateAmount } from "@/lib/repairPricing";
import { relevantPricingSignature } from "@/lib/pricingComparison";
import { needsWorkspaceReset } from "@/lib/sessionLifecycle";
import { calculateProject } from "@/lib/calculations";
import { createRepairLine, defaultRepairCatalog } from "@/lib/repairCatalog";
import { defaultRates, emptyInput } from "@/lib/rates";
import { costingInputsEqual } from "@/lib/builder";
import { createWorkPackage, packageProjectInput, updatePackageFromProjectInput } from "@/lib/workPackages";
import { normaliseSurveyInput, createEmptySurveyInput } from "@/lib/costing/survey/defaults";
import { projectToRow, rowToProject } from "@/lib/storage";
import type { ProjectInput, ProjectRecord, RepairLabourMode } from "@/lib/types";

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
function repairs(mode: RepairLabourMode = "both"): ProjectInput {
  const input = structuredClone(emptyInput);
  input.includeRepairs = true;
  input.repairs = { ...input.repairs, enabled: true, labourMode: mode, labourDays: 3, labourMen: 2,
    travelMode: "Drive", travelDays: 1, mobilisationOneWayKm: 100, mobilisationVehicles: 1,
    hotelRequired: true, hotelNights: 3,
    repairLines: [
      { ...createRepairLine("Type 3", defaultRepairCatalog), id: "one", lengthM: 12, widthMm: 50, depthMm: 50, outputPerDay: 12 },
      { ...createRepairLine("Type 3", defaultRepairCatalog), id: "two", lengthM: 24, widthMm: 50, depthMm: 50, outputPerDay: 12 }
    ],
    repairSubcontractors: [{ name: "Repair crew", priceType: "lump sum", rate: 1000, days: 3, margin: 0.3, mobilisationCost: 100, mobilisations: 1, mobilisationMargin: 0.3, standbyRate: 0, standbyMargin: 0.3 }],
    haulageItems: [{ name: "Delivery", rate: 100, quantity: 1, unit: "delivery", margin: 0.3, plCategory: "Haulage" }]
  };
  return input;
}

describe("draft stability and repair unit-price reconciliation", () => {
  it.each([[null, "user", true], ["user", "user", false], ["user", null, true], ["user", "other", true], [null, null, false]] as const)(
    "handles session identity %s -> %s without a refresh reset", (before, after, reset) => expect(needsWorkspaceReset(before, after)).toBe(reset)
  );
  it("allocates exact pennies and handles zero, negative and invalid weights", () => {
    expect(allocateAmount(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(allocateAmount(-10, [1, 1, 1])).toEqual([-3.34, -3.33, -3.33]);
    expect(allocateAmount(10, [0, NaN, -1])).toEqual([0, 0, 0]);
    for (let cents = 1; cents <= 333; cents++) expect(sum(allocateAmount(cents / 100, [1, 3, 7]))).toBe(cents / 100);
  });
  it.each(["in_house", "subcontract", "both"] as const)("reconciles exact repair totals in %s mode with discount and FX", (mode) => {
    for (const discount of [0, 7.5, 100]) for (const fx of [1, 1.23]) {
      const input = { ...repairs(mode), discountPercentage: discount, exchangeRateToCompanyCurrency: fx };
      const calc = calculateProject(input, defaultRates, defaultRepairCatalog);
      const detail = calc.repairPricing![0];
      expect(detail.unallocatedBudget).toBe(0);
      expect(detail.unallocatedSell).toBe(0);
      expect(sum(detail.rows.map((r) => r.budget).concat(detail.separateBudget))).toBe(calc.budgetCost);
      expect(sum(detail.rows.map((r) => r.sell).concat(detail.separateSell))).toBe(calc.proposalTotal);
      expect(sum(detail.rows.map((r) => r.materialBudget))).toBe(sum(calc.budgetLines.filter((l) => l.section === "Materials").map((l) => l.total)));
      expect(detail.rows.map((r) => r.labourShare)).toEqual([1 / 3, 2 / 3]);
      expect(detail.separateBudget).toBeGreaterThan(0);
    }
  });
  it("keeps PM and unrelated services outside repair unit prices", () => {
    const input = repairs();
    const original = calculateProject(input, defaultRates);
    input.projectManagement = { ...input.projectManagement, enabled: true, days: 2, hotelNights: 1 };
    const withPM = calculateProject(input, defaultRates);
    expect(withPM.budgetCost).toBeGreaterThan(original.budgetCost);
    expect(withPM.repairPricing).toEqual(original.repairPricing);
  });
  it("changes labour allocation without changing labour days, project cost or material shares", () => {
    const input = repairs();
    const original = calculateProject(input, defaultRates);
    input.repairs.repairLines[0].labourAllocationWeight = 2;
    const adjusted = calculateProject(input, defaultRates);
    expect(adjusted.proposalTotal).toBe(original.proposalTotal);
    expect(adjusted.budgetCost).toBe(original.budgetCost);
    expect(adjusted.siteDays).toBe(original.siteDays);
    expect(adjusted.repairPricing![0].rows.map((r) => r.labourShare)).toEqual([0.5, 0.5]);
    expect(adjusted.repairPricing![0].rows.map((r) => r.materialBudget)).toEqual(original.repairPricing![0].rows.map((r) => r.materialBudget));
    input.repairs.repairLines[0].labourAllocationWeight = 1;
    expect(calculateProject(input, defaultRates).repairPricing![0].rows[0].allocationOverridden).toBe(false);
  });
  it("shows each, linear and area units and retains costs when quantities are missing", () => {
    const input = repairs();
    input.repairs.repairLines.push({ ...createRepairLine("Type 5a", defaultRepairCatalog), eachQty: 10, holeDiameterMm: 30, holeDepthMm: 30 });
    input.repairs.repairLines.push({ ...createRepairLine("Type 4a", defaultRepairCatalog), areaM2: 8, thicknessMm: 15 });
    expect(calculateProject(input, defaultRates).repairPricing![0].rows.map((r) => r.unit)).toEqual(["m", "m", "each", "m2"]);
    input.repairs.repairLines = [createRepairLine("Type 3", defaultRepairCatalog)];
    const result = calculateProject(input, defaultRates);
    expect(result.repairPricing![0].rows[0].sell).toBe(0);
    expect(result.repairPricing![0].unallocatedBudget).toBeGreaterThan(0);
    expect(Number.isFinite(result.proposalTotal)).toBe(true);
  });
  it("consolidates awarded material budgets but retains independently offered selling prices", () => {
    const source = repairs("subcontract");
    source.repairs.repairSubcontractors = [];
    source.repairs.haulageItems = [];
    source.repairs.repairLines = [{ ...source.repairs.repairLines[0], lengthM: 0.1 }];
    const packages = [createWorkPackage("Repairs", source, 0), createWorkPackage("Repairs", source, 1)];
    const offered = calculateProject({ ...source, pricingMode: "selectable", workPackages: packages }, defaultRates);
    const awarded = calculateProject({ ...source, pricingMode: "selectable", workPackages: packages, selectionConfirmed: true }, defaultRates);
    expect(awarded.budgetCost).toBeLessThan(offered.budgetCost);
    expect(sum(awarded.repairPricing!.flatMap((p) => p.rows.map((r) => r.budget)))).toBe(awarded.budgetCost);
    expect(sum(awarded.repairPricing!.flatMap((p) => p.rows.map((r) => r.sell)))).toBe(awarded.proposalTotal);
    expect(awarded.proposalTotal).toBe(offered.proposalTotal);
  });
  it("only reports admin rate differences relevant to the current costing", () => {
    const input = repairs();
    const saved = calculateProject(input, defaultRates);
    expect(relevantPricingSignature(calculateProject(input, { ...defaultRates, grindingSurveyorDayRate: 9876 }))).toBe(relevantPricingSignature(saved));
    expect(relevantPricingSignature(calculateProject(input, { ...defaultRates, productionLabourDayRate: 9876 }))).not.toBe(relevantPricingSignature(saved));
    expect(relevantPricingSignature(calculateProject(input, structuredClone(defaultRates)))).toBe(relevantPricingSignature(saved));
  });
  it("starts with no haulage and preserves saved multiple-delivery quantities", () => {
    expect(emptyInput.repairs.haulageItems).toEqual([]);
    const input = repairs("subcontract");
    input.repairs.haulageItems = [{ name: "Legacy deliveries", rate: 75, quantity: 2, unit: "delivery", margin: 0.3, plCategory: "Haulage" }];
    const result = calculateProject(input, defaultRates);
    expect(result.proposalLines.find((line) => line.item === "Legacy deliveries")?.total).toBe(195);
    expect(result.budgetLines.find((line) => line.item === "Legacy deliveries")?.total).toBe(150);
    const workspace = readFileSync("app/workspace.tsx", "utf8");
    expect(workspace).toContain("item.quantity * item.rate * (1 + item.margin)");
    expect(workspace).toContain("No haulage included.");
  });
  it("retains independent package progress without treating navigation as a cost edit", () => {
    const parent = repairs();
    const workPackage = createWorkPackage("Repairs", parent);
    const updated = updatePackageFromProjectInput(workPackage, { ...packageProjectInput(parent, workPackage), uiProgress: { repairPage: "Labour" } });
    expect(packageProjectInput(parent, updated).uiProgress?.repairPage).toBe("Labour");
    expect(costingInputsEqual({ ...parent, workPackages: [workPackage] }, { ...parent, activeWorkPackageId: workPackage.id, workPackages: [updated] })).toBe(true);
  });
  it("round-trips allocations and exact prices with the saved snapshot", () => {
    const inputs = repairs();
    inputs.repairs.repairLines[0].labourAllocationWeight = 2;
    const record: ProjectRecord = { id: "test", companyId: "company", createdAt: "2026-09-04T00:00:00Z", status: "Draft", accountsStatus: "Not Required", inputs, calculations: calculateProject(inputs, defaultRates), rateSnapshot: defaultRates, repairCatalogSnapshot: defaultRepairCatalog, revisions: [] };
    const restored = rowToProject({ ...projectToRow(record, "company"), created_at: record.createdAt });
    expect(restored.inputs.repairs.repairLines[0].labourAllocationWeight).toBe(2);
    expect(restored.calculations.repairPricing).toEqual(record.calculations.repairPricing);
  });
  it("gives saved survey extras stable keys independent of their description", () => {
    const input = createEmptySurveyInput();
    input.additionalItems = [{ name: "Before", rate: 10, quantity: 1, markup: 0.3, unit: "item", plCategory: "Equipment" }];
    const normalised = normaliseSurveyInput(input);
    const id = normalised.additionalItems[0].id;
    normalised.additionalItems[0].name = "After";
    expect(normaliseSurveyInput(normalised).additionalItems[0].id).toBe(id);
  });
  it("keeps background autosave navigation and expected downtime out of new-entry UI", () => {
    const workspace = readFileSync("app/workspace.tsx", "utf8");
    expect(workspace).toContain("window.history.replaceState");
    expect(workspace).not.toContain('router.replace(`/new-project/');
    expect(readFileSync("components/CommercialRateEditor.tsx", "utf8")).not.toContain('label="Expected Stand');
    expect(readFileSync("components/survey/SurveyBuilder.tsx", "utf8")).not.toContain("key={item.description}");
    expect(createWorkPackage("Grinding").expectedStandDownDays).toBe(0);
  });
});
