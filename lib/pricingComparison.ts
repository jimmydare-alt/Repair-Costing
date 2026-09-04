import type { ProjectCalculations } from "./types";

export function relevantPricingSignature(calculation: ProjectCalculations) {
  const lines = (rows: ProjectCalculations["proposalLines"]) => rows.filter((row) => row.quantity !== 0 || row.total !== 0)
    .map(({ section, item, rate, quantity, cost, total, discount, plCategory }) => ({ section, item, rate, quantity, cost, total, discount, plCategory }));
  return JSON.stringify({ proposal: lines(calculation.proposalLines), budget: lines(calculation.budgetLines),
    days: [calculation.siteDays, calculation.grindingDays, calculation.screedDays, calculation.repairDays],
    dailyRate: calculation.dailyRate, standbyRate: calculation.standbyRate, schedules: calculation.rateSchedules });
}
