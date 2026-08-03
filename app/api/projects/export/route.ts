import { NextResponse } from "next/server";
import { calculateProject } from "@/lib/calculations";
import { defaultRates, validationInput } from "@/lib/rates";

export async function GET() {
  const calculations = calculateProject(validationInput, defaultRates);
  const rows = [["Section", "Item", "Rate", "Unit", "Quantity", "Cost", "Margin", "Discount", "Total", "Source"]];
  calculations.proposalLines.forEach((line) => rows.push([line.section, line.item, line.rate, line.unit, line.quantity, line.cost, line.margin, line.discount, line.total, line.source].map(String)));
  const csv = rows.map((row) => row.map((cell) => cell.includes(",") ? `"${cell.replace(/"/g, "\"\"")}"` : cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=face-gmbh-validation-export.csv"
    }
  });
}
