import type { Line, PLCategory, ProjectRecord } from "./types";

export type HandoverRow = {
  description: string;
  quantity: number;
  unit: string;
  budget: number;
};

export type HandoverSummary = {
  materials: HandoverRow[];
  subcontractors: HandoverRow[];
  labour: HandoverRow[];
  equipment: HandoverRow[];
  logistics: HandoverRow[];
  categories: Array<{ category: PLCategory; budget: number }>;
  actions: string[];
};

const categories: PLCategory[] = ["Labour", "Subcontract", "Materials", "Equipment", "Travel", "Hotel/Subsistence", "Haulage"];

function lineCategory(line: Line): PLCategory {
  if (line.plCategory) return line.plCategory;
  if (line.section === "Subcontract") return "Subcontract";
  if (line.section === "Materials") return "Materials";
  if (line.section === "Equipment" || line.section === "Additional items") return "Equipment";
  if (line.section === "Travel") return "Travel";
  if (line.section === "Hotel" || line.section === "Subsistence") return "Hotel/Subsistence";
  if (line.section === "Haulage") return "Haulage";
  return "Labour";
}

function aggregate(lines: Line[]) {
  const rows = new Map<string, HandoverRow>();
  lines.filter((line) => line.quantity || line.cost).forEach((line) => {
    const description = line.workPackageCode ? `${line.workPackageCode}. ${line.workPackageName} - ${line.item}` : line.item;
    const key = `${line.workPackageId ?? "common"}|${line.item.toLowerCase()}|${line.unit.toLowerCase()}`;
    const current = rows.get(key) ?? { description, quantity: 0, unit: line.unit, budget: 0 };
    current.quantity += line.quantity;
    current.budget += line.cost;
    rows.set(key, current);
  });
  return Array.from(rows.values());
}

function aggregateSubcontractors(lines: Line[]) {
  const rows = new Map<string, HandoverRow>();
  lines.filter((line) => line.quantity || line.cost).forEach((line) => {
    const baseDescription = line.item.replace(/ mobilisation$/i, "").replace(/ price on site$/i, "");
    const description = line.workPackageCode ? `${line.workPackageCode}. ${line.workPackageName} - ${baseDescription}` : baseDescription;
    const key = `${line.workPackageId ?? "common"}|${baseDescription.toLowerCase()}`;
    const current = rows.get(key) ?? { description, quantity: 1, unit: "package", budget: 0 };
    current.budget += line.cost;
    rows.set(key, current);
  });
  return Array.from(rows.values());
}

export function buildHandoverSummary(project: ProjectRecord): HandoverSummary {
  const lines = project.calculations.budgetLines;
  const materials = aggregate(lines.filter((line) => lineCategory(line) === "Materials"));
  const subcontractors = aggregateSubcontractors(lines.filter((line) => lineCategory(line) === "Subcontract"));
  const labour = aggregate(lines.filter((line) => lineCategory(line) === "Labour"));
  const equipment = aggregate(lines.filter((line) => lineCategory(line) === "Equipment"));
  const logistics = aggregate(lines.filter((line) => ["Travel", "Hotel/Subsistence", "Haulage"].includes(lineCategory(line))));
  const categoryRows = categories.map((category) => ({
    category,
    budget: lines.filter((line) => lineCategory(line) === category).reduce((sum, line) => sum + line.cost, 0)
  })).filter((row) => row.budget > 0);
  const actions: string[] = [];
  if (materials.length) actions.push(`Order and confirm ${materials.length} material type${materials.length === 1 ? "" : "s"}.`);
  if (subcontractors.length) actions.push(`Appoint and confirm ${subcontractors.length} subcontract work package${subcontractors.length === 1 ? "" : "s"}.`);
  if (project.calculations.siteDays > 0) actions.push(`Confirm the ${project.calculations.siteDays}-day project programme and service sequence.`);
  if (lines.some((line) => line.section === "Hotel" && line.cost > 0)) actions.push("Confirm accommodation bookings before mobilisation.");
  if (lines.some((line) => line.plCategory === "Haulage" && line.cost > 0)) actions.push("Confirm haulage and delivery dates with the site programme.");
  return { materials, subcontractors, labour, equipment, logistics, categories: categoryRows, actions };
}
