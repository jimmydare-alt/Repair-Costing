import type { Line, MaterialCalc, RepairCatalog, RepairLineItem } from "./types";
import { repairTypeByCode } from "./repairCatalog";

const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100 || 0;
const sum = (values: number[]) => rounded(values.reduce((a, b) => a + b, 0));

// Allocate pennies rather than rounded unit prices, preserving exact line totals.
export function allocateAmount(amount: number, weights: number[]): number[] {
  const positive = weights.map((weight) => Number.isFinite(weight) ? Math.max(0, weight) : 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  const pennies = Math.round(Math.abs(amount) * 100);
  const exact = positive.map((weight) => pennies * weight / total);
  const parts = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, fraction: value - parts[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const remainder = pennies - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) parts[order[i % order.length].index] += 1;
  return parts.map((value) => (amount < 0 ? -value : value) / 100);
}

export type RepairPriceRow = {
  id: string; label: string; quantity: number; unit: string;
  calculatedDays: number; allocationWeight: number; allocationOverridden: boolean; labourShare: number;
  materials: Array<{ id: string; requirement: number; budget: number; sell: number }>;
  materialBudget: number; materialSell: number; labourBudget: number; labourSell: number; budget: number; sell: number;
};
export type RepairPriceBreakdown = {
  packageId?: string; packageName?: string; rows: RepairPriceRow[];
  separateBudget: number; separateSell: number; unallocatedBudget: number; unallocatedSell: number;
};

export function repairAllocationDays(item: RepairLineItem, catalog: RepairCatalog) {
  const type = repairTypeByCode(item.repairTypeCode, catalog);
  const quantity = type.measurementBasis === "each" ? item.eachQty : type.measurementBasis === "area" ? item.areaM2 : type.measurementBasis === "manual" ? item.manualMaterialQty : item.lengthM;
  return Math.max(0, quantity) / Math.max(0.000001, item.outputPerDay || type.defaultOutputPerDay || 1);
}

export function buildRepairPriceBreakdown(items: RepairLineItem[], catalog: RepairCatalog, requirements: MaterialCalc[][], materials: MaterialCalc[], proposal: Line[], budget: Line[]): RepairPriceBreakdown {
  const rows: RepairPriceRow[] = items.map((item) => {
    const type = repairTypeByCode(item.repairTypeCode, catalog);
    const calculatedDays = repairAllocationDays(item, catalog);
    const quantity = type.measurementBasis === "each" ? item.eachQty : type.measurementBasis === "area" ? item.areaM2 : type.measurementBasis === "manual" ? item.manualMaterialQty : item.lengthM;
    return { id: item.id, label: `${type.code} / ${item.description || type.name}`, quantity,
      unit: type.measurementBasis === "each" ? "each" : type.measurementBasis === "area" ? "m2" : type.measurementBasis === "manual" ? "item" : "m",
      calculatedDays, allocationWeight: Math.max(0, item.labourAllocationWeight ?? calculatedDays),
      allocationOverridden: item.labourAllocationWeight != null && item.labourAllocationWeight !== calculatedDays,
      labourShare: 0, materials: [], materialBudget: 0, materialSell: 0, labourBudget: 0, labourSell: 0, budget: 0, sell: 0 };
  });
  const materialProposal = proposal.filter((row) => row.section === "Materials");
  const materialBudget = budget.filter((row) => row.section === "Materials");
  materials.forEach((material, index) => {
    const id = material.materialId ?? material.product;
    const weights = requirements.map((line) => line.filter((entry) => (entry.materialId ?? entry.product) === id).reduce((total, entry) => total + (entry.unroundedUnits ?? entry.quantity), 0));
    const budgets = allocateAmount(materialBudget[index]?.total ?? 0, weights);
    const sells = allocateAmount(materialProposal[index]?.total ?? 0, weights);
    rows.forEach((row, i) => { if (weights[i]) row.materials.push({ id, requirement: weights[i], budget: budgets[i], sell: sells[i] }); });
  });
  const isLabour = (row: Line) => row.costKind !== "mobilisation" && ["Labour", "Subcontract", "Hotel", "Subsistence"].includes(row.section);
  const labourBudgetTotal = sum(budget.filter(isLabour).map((row) => row.total));
  const labourSellTotal = sum(proposal.filter(isLabour).map((row) => row.total));
  const weights = rows.map((row) => row.quantity > 0 ? row.allocationWeight : 0);
  const shares = weights.reduce((a, b) => a + b, 0);
  const labourBudgets = allocateAmount(labourBudgetTotal, weights);
  const labourSells = allocateAmount(labourSellTotal, weights);
  rows.forEach((row, index) => {
    row.labourShare = shares ? weights[index] / shares : 0;
    row.materialBudget = sum(row.materials.map((material) => material.budget));
    row.materialSell = sum(row.materials.map((material) => material.sell));
    row.labourBudget = labourBudgets[index]; row.labourSell = labourSells[index];
    row.budget = sum([row.materialBudget, row.labourBudget]); row.sell = sum([row.materialSell, row.labourSell]);
  });
  const separate = (row: Line) => row.section !== "Materials" && !isLabour(row);
  const separateBudget = sum(budget.filter(separate).map((row) => row.total));
  const separateSell = sum(proposal.filter(separate).map((row) => row.total));
  return { rows, separateBudget, separateSell,
    unallocatedBudget: rounded(sum(budget.map((row) => row.total)) - separateBudget - sum(rows.map((row) => row.budget))),
    unallocatedSell: rounded(sum(proposal.map((row) => row.total)) - separateSell - sum(rows.map((row) => row.sell))) };
}

export function consolidateRepairPricing(breakdowns: RepairPriceBreakdown[], materials: MaterialCalc[]) {
  const result = structuredClone(breakdowns);
  const allRows = result.flatMap((breakdown) => breakdown.rows);
  materials.forEach((material) => {
    const id = material.materialId ?? material.product;
    const entries = allRows.flatMap((row) => row.materials.filter((entry) => entry.id === id));
    const budgets = allocateAmount(material.cost, entries.map((entry) => entry.requirement));
    entries.forEach((entry, index) => { entry.budget = budgets[index]; });
  });
  allRows.forEach((row) => {
    row.materialBudget = sum(row.materials.map((entry) => entry.budget));
    row.budget = sum([row.materialBudget, row.labourBudget]);
  });
  return result;
}
