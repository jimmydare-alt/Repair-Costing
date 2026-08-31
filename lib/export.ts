import type { ProjectRecord } from "./types";

export function projectCsv(project: ProjectRecord) {
  const selectable = project.inputs.pricingMode === "selectable";
  const selectionConfirmed = Boolean(project.packageSelection?.confirmedAt || project.inputs.selectionConfirmed);
  const selectedIds = new Set(project.packageSelection?.selectedPackageIds ?? project.inputs.workPackages.filter((item) => item.selected).map((item) => item.id));
  const lines = selectable ? project.calculations.offeredProposalLines ?? project.calculations.proposalLines : project.calculations.proposalLines;
  const rows = [["Record Type", "Scope Status", "Package Code", "Package Name", "P&L Category", "Section", "Item", "Rate", "Unit", "Quantity", "Budget Cost", "Markup Value", "Discount", "Sell Value"]];
  lines.forEach((line) => {
    const workPackage = line.workPackageId ? project.inputs.workPackages.find((item) => item.id === line.workPackageId) : undefined;
    const scopeStatus = line.commercialGroup === "common" ? "Common" : !selectable ? "Included" : !selectionConfirmed ? "Offered" : workPackage && selectedIds.has(workPackage.id) ? "Selected" : "Not selected";
    rows.push([selectable ? "Commercial offer" : "Costing", scopeStatus, line.workPackageCode ?? "", line.workPackageName ?? "Common project costs", line.plCategory, line.section, line.item, line.rate, line.unit, line.quantity, line.cost, line.margin, line.discount, line.total].map(String));
  });
  if (selectable && selectionConfirmed) project.calculations.budgetLines.forEach((line) => rows.push(["Selected execution budget", "Selected", line.workPackageCode ?? "", line.workPackageName ?? "Consolidated / common", line.plCategory, line.section, line.item, line.rate, line.unit, line.quantity, line.cost, 0, 0, ""].map(String)));
  return rows.map((row) => row.map((cell) => cell.includes(",") ? `"${cell.replace(/"/g, "\"\"")}"` : cell).join(",")).join("\n");
}
