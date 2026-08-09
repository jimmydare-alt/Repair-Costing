import type { ProjectRecord } from "./types";

export function projectCsv(project: ProjectRecord) {
  const rows = [["P&L Category", "Section", "Item", "Rate", "Unit", "Quantity", "Budget Cost", "Markup Value", "Discount", "Sell Value"]];
  project.calculations.proposalLines.forEach((line) => rows.push([line.plCategory, line.section, line.item, line.rate, line.unit, line.quantity, line.cost, line.margin, line.discount, line.total].map(String)));
  return rows.map((row) => row.map((cell) => cell.includes(",") ? `"${cell.replace(/"/g, "\"\"")}"` : cell).join(",")).join("\n");
}
