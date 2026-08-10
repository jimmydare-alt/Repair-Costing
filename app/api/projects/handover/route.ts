import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import type { ProjectRecord } from "@/lib/types";
import { buildHandoverSummary, type HandoverRow } from "@/lib/handover";
import { normaliseProjectStatus } from "@/lib/workflow";

export const runtime = "nodejs";

function currency(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
}

function table(doc: PDFKit.PDFDocument, title: string, rows: HandoverRow[], code: string) {
  if (!rows.length) return;
  if (doc.y > 680) doc.addPage();
  doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).fillColor("#172033").text(title);
  doc.moveDown(0.35).font("Helvetica").fontSize(8.5).fillColor("#3f4b5f");
  rows.forEach((row) => {
    if (doc.y > 735) doc.addPage();
    const y = doc.y;
    doc.text(row.description, 48, y, { width: 300 });
    doc.text(`${Number(row.quantity.toFixed(3))} ${row.unit}`, 355, y, { width: 85, align: "right" });
    doc.text(currency(row.budget, code), 452, y, { width: 95, align: "right" });
    doc.moveTo(48, doc.y + 3).lineTo(547, doc.y + 3).strokeColor("#dce1e7").lineWidth(0.5).stroke();
    doc.moveDown(0.45);
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  try {
    if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Cross-site handover requests are not allowed." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "The handover request origin is invalid." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) return NextResponse.json({ error: "The handover request is too large." }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 2_000_000) return NextResponse.json({ error: "The handover request is too large." }, { status: 413 });
  let body: { project?: ProjectRecord; companyName?: string; primaryColour?: string };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "The handover request is not valid JSON." }, { status: 400 });
  }
  if (!body.project?.id || !Array.isArray(body.project.calculations?.budgetLines) || !Number.isFinite(body.project.calculations?.budgetCost)) return NextResponse.json({ error: "A valid saved project is required." }, { status: 400 });
  const project = body.project;
  if (!["Costing Complete", "Won", "Handover Issued"].includes(normaliseProjectStatus(project.status))) return NextResponse.json({ error: "Complete the costing before generating a handover." }, { status: 409 });
  const summary = buildHandoverSummary(project);
  const code = project.inputs.quoteCurrency;
  const primaryColour = /^#[0-9a-f]{6}$/i.test(body.primaryColour ?? "") ? body.primaryColour! : "#b91c1c";
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${project.inputs.projectReference} Project Cost & Delivery Summary`, Author: body.companyName || "CoGri Group" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, 595, 86).fill("#181b1a");
  doc.rect(0, 82, 595, 4).fill(primaryColour);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(body.companyName || "CoGri Group", 48, 28);
  doc.font("Helvetica").fontSize(9).fillColor("#d8ddda").text("PROJECT COST & DELIVERY SUMMARY", 48, 54);
  doc.fillColor("#172033").font("Helvetica-Bold").fontSize(20).text(project.inputs.projectReference || "Unreferenced project", 48, 112);
  doc.font("Helvetica").fontSize(10).fillColor("#536176").text(`${project.inputs.client} | ${project.inputs.location}`);
  doc.moveDown(0.4).text(`${project.calculations.serviceSummary} | Revision ${project.inputs.revision || project.revisions?.length || 1} | ${project.status}`);
  doc.moveDown(1).roundedRect(48, doc.y, 499, 55, 7).fill("#f3f5f7");
  const summaryY = doc.y + 14;
  doc.fillColor("#172033").font("Helvetica-Bold").fontSize(9).text("PROJECT BUDGET", 64, summaryY).fontSize(15).text(currency(project.calculations.budgetCost, code), 64, summaryY + 16);
  doc.fontSize(9).text("PROJECT DAYS", 250, summaryY).fontSize(15).text(String(project.calculations.siteDays), 250, summaryY + 16);
  doc.fontSize(9).text("SERVICES", 375, summaryY).fontSize(10).text(project.calculations.serviceSummary, 375, summaryY + 17, { width: 150 });
  doc.y = summaryY + 55;

  if (summary.actions.length) {
    doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).text("Actions before site");
    doc.moveDown(0.3).font("Helvetica").fontSize(9);
    summary.actions.forEach((action) => doc.text(`- ${action}`, { indent: 8, paragraphGap: 3 }));
  }
  table(doc, "Materials to procure", summary.materials, code);
  table(doc, "Subcontract work packages", summary.subcontractors, code);
  table(doc, "Internal labour", summary.labour, code);
  table(doc, "Equipment", summary.equipment, code);
  table(doc, "Travel, accommodation and haulage", summary.logistics, code);

  if (doc.y > 650) doc.addPage();
  doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).text("Budget by P&L category");
  doc.moveDown(0.4).font("Helvetica").fontSize(9);
  summary.categories.forEach((row) => doc.text(`${row.category}: ${currency(row.budget, code)}`));
  doc.moveDown(0.8).font("Helvetica-Bold").text(`Total budget: ${currency(project.calculations.budgetCost, code)}`);

  doc.moveDown(1).fontSize(8).fillColor("#6c7480").text("Internal and confidential. Generated from the saved project costing revision. Verify live site conditions and supplier availability before ordering.");
  doc.end();
  const pdf = await complete;
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${(project.inputs.projectReference || "project").replace(/[^a-z0-9-_]/gi, "-")}-delivery-summary.pdf"` } });
}
