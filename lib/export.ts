import type { ProjectRecord } from "./types";

export function projectCsv(project: ProjectRecord) {
  const rows = [["Section", "Item", "Rate", "Unit", "Quantity", "Cost", "Margin", "Discount", "Total", "Source"]];
  project.calculations.proposalLines.forEach((line) => rows.push([line.section, line.item, line.rate, line.unit, line.quantity, line.cost, line.margin, line.discount, line.total, line.source].map(String)));
  return rows.map((row) => row.map((cell) => cell.includes(",") ? `"${cell.replace(/"/g, "\"\"")}"` : cell).join(",")).join("\n");
}
