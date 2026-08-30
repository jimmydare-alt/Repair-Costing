import PDFDocument from "pdfkit";
import { buildHandoverSummary, type HandoverRow } from "./handover";
import type { ProjectRecord } from "./types";

type CompanyIdentity = {
  name: string;
  primaryColour: string;
  darkColour: string;
  logo?: Buffer;
};

export type HandoverPdfOptions = {
  project: ProjectRecord;
  company: CompanyIdentity;
  generatedAt?: Date;
  generatedBy?: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const DETAIL_TOP = 96;
const CONTENT_BOTTOM = 790;
const FALLBACK_PRIMARY = "#b91c1c";
const FALLBACK_DARK = "#172033";
const INK = "#172033";
const MUTED = "#5f6d82";
const PALE = "#f4f6f8";
const LINE = "#dbe1e8";
const WHITE = "#ffffff";

function safeColour(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .trim();
}

function currency(value: number, code: string) {
  try {
    return clean(new Intl.NumberFormat("en-GB", { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value));
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}

function quantity(value: number) {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(3)).toString();
}

function unitLabel(value: string, amount: number) {
  const unit = clean(value).toLowerCase();
  const labels: Record<string, [string, string]> = {
    "man day": ["man-day", "man-days"],
    "man night": ["man-night", "man-nights"],
    "surveyor day": ["surveyor-day", "surveyor-days"],
    "surveyor night": ["surveyor-night", "surveyor-nights"],
    "room night": ["room-night", "room-nights"],
    "generator day": ["generator-day", "generator-days"],
    "grinder day": ["grinder-day", "grinder-days"],
    "planer day": ["planer-day", "planer-days"],
    "vacuum day": ["vacuum-day", "vacuum-days"],
    "set day": ["set-day", "set-days"],
    "full units": ["full unit", "full units"]
  };
  const pair = labels[unit];
  if (pair) return amount === 1 ? pair[0] : pair[1];
  if (amount !== 1 && ["day", "night", "item", "package", "unit", "bag", "week", "mobilisation"].includes(unit)) return `${unit}s`;
  return unit || "item";
}

function revisionLabel(project: ProjectRecord) {
  return clean(project.inputs.revision) || String(project.revisions?.length || 1);
}

function labourApproach(project: ProjectRecord) {
  const modes: string[] = [];
  if (project.inputs.pricingMode === "selectable") {
    project.inputs.workPackages.filter((item) => !project.inputs.selectionConfirmed || item.selected).forEach((item) => {
      if (item.grinding) modes.push(item.grinding.productionLabourMode, item.grinding.surveyorLabourMode);
      if (item.screeding) modes.push(item.screeding.productionLabourMode, item.screeding.surveyorLabourMode);
      if (item.repairs) modes.push(item.repairs.labourMode);
    });
  }
  if (project.inputs.pricingMode !== "selectable") {
    if (project.inputs.includeGrinding && project.inputs.grinding.enabled) modes.push(project.inputs.grinding.productionLabourMode, project.inputs.grinding.surveyorLabourMode);
    if (project.inputs.includeScreeding && project.inputs.screeding.enabled) modes.push(project.inputs.screeding.productionLabourMode, project.inputs.screeding.surveyorLabourMode);
    if (project.inputs.includeRepairs && project.inputs.repairs.enabled) modes.push(project.inputs.repairs.labourMode);
  }
  if (project.inputs.costingModule === "survey" && project.inputs.survey?.surveyorSupply) modes.push(project.inputs.survey.surveyorSupply);
  const normalised = modes.map((mode) => clean(mode).toLowerCase());
  const inHouse = normalised.some((mode) => mode.includes("in_house") || mode.includes("in-house") || mode === "both");
  const subcontract = normalised.some((mode) => mode.includes("subcontract") || mode === "both");
  if (inHouse && subcontract) return "Mixed delivery";
  if (subcontract) return "Subcontract";
  if (inHouse) return "In-house";
  return "Not specified";
}

function serviceSummary(value: string) {
  const summary = clean(value);
  return summary && summary !== "Draft" ? summary : "Not specified";
}

function drawLogo(doc: PDFKit.PDFDocument, company: CompanyIdentity) {
  const x = MARGIN;
  const y = 20;
  const width = 132;
  const height = 48;
  doc.roundedRect(x, y, width, height, 5).fill(WHITE);
  if (company.logo) {
    try {
      if (company.name.toLowerCase().includes("face")) {
        doc.save().roundedRect(x, y, width, height, 5).clip();
        doc.image(company.logo, x + 2, y - 4, { fit: [width - 4, 62], align: "center", valign: "center" });
        doc.restore();
      } else {
        doc.image(company.logo, x + 8, y + 4, { fit: [width - 16, height - 8], align: "center", valign: "center" });
      }
      return;
    } catch {
      // A corrupt custom image should not prevent the delivery pack from being generated.
    }
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(clean(company.name), x + 8, y + 17, { width: width - 16, align: "center", ellipsis: true });
}

function drawCoverHeader(doc: PDFKit.PDFDocument, options: HandoverPdfOptions, generatedLabel: string) {
  const dark = safeColour(options.company.darkColour, FALLBACK_DARK);
  const primary = safeColour(options.company.primaryColour, FALLBACK_PRIMARY);
  doc.rect(0, 0, PAGE_WIDTH, 90).fill(dark);
  doc.rect(0, 86, PAGE_WIDTH, 4).fill(primary);
  drawLogo(doc, options.company);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(8.5).text("INTERNAL DELIVERY PACK", 316, 23, { width: 237, align: "right", characterSpacing: 0.5 });
  doc.font("Helvetica").fontSize(8).fillColor("#d8dee8").text("Project Cost & Delivery Summary", 316, 40, { width: 237, align: "right" });
  doc.text(`Generated ${generatedLabel}`, 316, 55, { width: 237, align: "right" });
}

function drawDetailHeader(doc: PDFKit.PDFDocument, options: HandoverPdfOptions) {
  const dark = safeColour(options.company.darkColour, FALLBACK_DARK);
  const primary = safeColour(options.company.primaryColour, FALLBACK_PRIMARY);
  doc.rect(0, 0, PAGE_WIDTH, 64).fill(dark);
  doc.rect(0, 60, PAGE_WIDTH, 4).fill(primary);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(12).text(clean(options.company.name), MARGIN, 20, { width: 235, ellipsis: true });
  doc.font("Helvetica").fontSize(8).fillColor("#d8dee8").text("PROJECT DELIVERY SCHEDULE", MARGIN, 39, { width: 235, characterSpacing: 0.35 });
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(10).text(clean(options.project.inputs.projectReference) || "Unreferenced project", 330, 22, { width: 223, align: "right", ellipsis: true });
  doc.font("Helvetica").fontSize(8).fillColor("#d8dee8").text(`Revision ${revisionLabel(options.project)}`, 330, 40, { width: 223, align: "right" });
}

function field(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x, y, { width, characterSpacing: 0.4 });
  doc.fillColor(INK).font("Helvetica").fontSize(9.4).text(clean(value) || "Not provided", x, y + 13, { width, height: 24, ellipsis: true });
}

function metric(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number, primary: string) {
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x, y, { width, characterSpacing: 0.35 });
  doc.fillColor(primary).font("Helvetica-Bold").fontSize(value.length > 22 ? 10 : 14).text(value, x, y + 16, { width, height: 30, ellipsis: true });
}

function drawOverview(doc: PDFKit.PDFDocument, options: HandoverPdfOptions, generatedLabel: string) {
  const { project } = options;
  const summary = buildHandoverSummary(project);
  const primary = safeColour(options.company.primaryColour, FALLBACK_PRIMARY);
  const code = project.inputs.quoteCurrency;
  drawCoverHeader(doc, options, generatedLabel);

  doc.fillColor(primary).font("Helvetica-Bold").fontSize(7.5).text("PROJECT", MARGIN, 111, { characterSpacing: 0.6 });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(clean(project.inputs.projectReference) || "Unreferenced project", MARGIN, 127, { width: 360, height: 30, ellipsis: true });
  const status = clean(project.status).toUpperCase();
  const statusWidth = Math.min(142, Math.max(78, doc.widthOfString(status) + 24));
  doc.roundedRect(PAGE_WIDTH - MARGIN - statusWidth, 122, statusWidth, 25, 12).fill(PALE);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text(status, PAGE_WIDTH - MARGIN - statusWidth, 131, { width: statusWidth, align: "center", characterSpacing: 0.25 });

  const fieldWidth = (CONTENT_WIDTH - 24) / 3;
  field(doc, "Client", project.inputs.client, MARGIN, 172, fieldWidth);
  field(doc, "Location", project.inputs.location, MARGIN + fieldWidth + 12, 172, fieldWidth);
  field(doc, "Services", serviceSummary(project.calculations.serviceSummary), MARGIN + (fieldWidth + 12) * 2, 172, fieldWidth);
  field(doc, "Project type", project.inputs.projectType, MARGIN, 218, fieldWidth);
  field(doc, "Costed by", project.inputs.costedBy, MARGIN + fieldWidth + 12, 218, fieldWidth);
  field(doc, "Revision", revisionLabel(project), MARGIN + (fieldWidth + 12) * 2, 218, fieldWidth);

  const bandY = 270;
  doc.roundedRect(MARGIN, bandY, CONTENT_WIDTH, 67, 8).fill(PALE);
  const metricWidth = CONTENT_WIDTH / 4;
  metric(doc, "Project budget", currency(project.calculations.budgetCost, code), MARGIN + 16, bandY + 13, metricWidth - 22, primary);
  metric(doc, "Project days", quantity(project.calculations.siteDays), MARGIN + metricWidth + 10, bandY + 13, metricWidth - 22, primary);
  metric(doc, "Labour approach", labourApproach(project), MARGIN + metricWidth * 2 + 10, bandY + 13, metricWidth - 22, primary);
  metric(doc, "Material types", String(summary.materials.length), MARGIN + metricWidth * 3 + 10, bandY + 13, metricWidth - 22, primary);
  for (let i = 1; i < 4; i += 1) doc.moveTo(MARGIN + metricWidth * i, bandY + 12).lineTo(MARGIN + metricWidth * i, bandY + 55).strokeColor(LINE).lineWidth(0.7).stroke();

  let y = 368;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("Pre-site actions", MARGIN, y);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Operational checks generated from the saved costing revision.", MARGIN, y + 18);
  y += 40;
  const actions = summary.actions.length ? summary.actions.slice(0, 5) : ["No advance actions were identified from the saved costing."];
  actions.forEach((action, index) => {
    const actionY = y + index * 25;
    doc.roundedRect(MARGIN, actionY + 1, 13, 13, 2).strokeColor(LINE).lineWidth(1).stroke();
    doc.fillColor(INK).font("Helvetica").fontSize(8.6).text(clean(action), MARGIN + 22, actionY, { width: CONTENT_WIDTH - 22, height: 20, ellipsis: true });
  });
  y += actions.length * 25 + 18;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("Budget by P&L category", MARGIN, y);
  y += 24;
  doc.rect(MARGIN, y, CONTENT_WIDTH, 24).fill(safeColour(options.company.darkColour, FALLBACK_DARK));
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(7.5).text("CATEGORY", MARGIN + 10, y + 8, { width: 300, characterSpacing: 0.35 });
  doc.text("SHARE", 372, y + 8, { width: 64, align: "right", characterSpacing: 0.35 });
  doc.text("BUDGET COST", 444, y + 8, { width: 97, align: "right", characterSpacing: 0.35 });
  y += 24;
  summary.categories.forEach((row, index) => {
    const rowY = y + index * 23;
    if (index % 2 === 0) doc.rect(MARGIN, rowY, CONTENT_WIDTH, 23).fill(PALE);
    const share = project.calculations.budgetCost ? row.budget / project.calculations.budgetCost * 100 : 0;
    doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(clean(row.category), MARGIN + 10, rowY + 7, { width: 300, ellipsis: true });
    doc.fillColor(MUTED).text(`${Math.round(share)}%`, 372, rowY + 7, { width: 64, align: "right" });
    doc.fillColor(INK).font("Helvetica-Bold").text(currency(row.budget, code), 444, rowY + 7, { width: 97, align: "right" });
  });
  y += summary.categories.length * 23;
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(primary).lineWidth(1.2).stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("TOTAL PROJECT BUDGET", MARGIN + 10, y + 9, { width: 330 });
  doc.fillColor(primary).fontSize(11).text(currency(project.calculations.budgetCost, code), 426, y + 7, { width: 115, align: "right" });
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, dark: string) {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 25).fill(dark);
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(7.2);
  doc.text("ITEM / SCOPE", MARGIN + 9, y + 9, { width: 278, characterSpacing: 0.3 });
  doc.text("QTY", 332, y + 9, { width: 48, align: "right", characterSpacing: 0.3 });
  doc.text("UNIT / BASIS", 392, y + 9, { width: 83, characterSpacing: 0.3 });
  doc.text("BUDGET", 482, y + 9, { width: 69, align: "right", characterSpacing: 0.3 });
  return y + 25;
}

function rowHeight(doc: PDFKit.PDFDocument, row: HandoverRow) {
  doc.font("Helvetica").fontSize(8.4);
  const descriptionHeight = doc.heightOfString(clean(row.description), { width: 274 });
  const unitHeight = doc.heightOfString(unitLabel(row.unit, row.quantity), { width: 79 });
  return Math.max(26, Math.ceil(Math.max(descriptionHeight, unitHeight)) + 13);
}

function addDetailPage(doc: PDFKit.PDFDocument) {
  doc.addPage();
  return DETAIL_TOP;
}

function drawSection(doc: PDFKit.PDFDocument, options: HandoverPdfOptions, title: string, note: string, rows: HandoverRow[], startY: number) {
  if (!rows.length) return startY;
  const primary = safeColour(options.company.primaryColour, FALLBACK_PRIMARY);
  const dark = safeColour(options.company.darkColour, FALLBACK_DARK);
  const code = options.project.inputs.quoteCurrency;
  let y = startY;
  let continuation = false;
  let index = 0;
  const drawHeading = () => {
    doc.rect(MARGIN, y + 1, 4, 32).fill(primary);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(`${title}${continuation ? " (continued)" : ""}`, MARGIN + 13, y, { width: 330 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.8).text(note, MARGIN + 13, y + 17, { width: CONTENT_WIDTH - 13, height: 16, ellipsis: true });
    y += 41;
    y = drawTableHeader(doc, y, dark);
  };
  if (y + 92 > CONTENT_BOTTOM) y = addDetailPage(doc);
  drawHeading();

  while (index < rows.length) {
    const row = rows[index];
    const height = rowHeight(doc, row);
    if (y + height + 31 > CONTENT_BOTTOM) {
      y = addDetailPage(doc);
      continuation = true;
      drawHeading();
    }
    if (index % 2 === 0) doc.rect(MARGIN, y, CONTENT_WIDTH, height).fill(PALE);
    doc.fillColor(INK).font("Helvetica").fontSize(8.4).text(clean(row.description), MARGIN + 9, y + 8, { width: 274 });
    doc.fillColor(INK).font("Helvetica-Bold").text(quantity(row.quantity), 332, y + 8, { width: 48, align: "right" });
    doc.fillColor(MUTED).font("Helvetica").text(unitLabel(row.unit, row.quantity), 392, y + 8, { width: 83 });
    doc.fillColor(INK).font("Helvetica-Bold").text(currency(row.budget, code), 482, y + 8, { width: 69, align: "right" });
    doc.moveTo(MARGIN, y + height).lineTo(PAGE_WIDTH - MARGIN, y + height).strokeColor(LINE).lineWidth(0.45).stroke();
    y += height;
    index += 1;
  }
  const subtotal = rows.reduce((sum, row) => sum + row.budget, 0);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text("SECTION BUDGET", 348, y + 9, { width: 104, align: "right", characterSpacing: 0.25 });
  doc.fillColor(primary).fontSize(9).text(currency(subtotal, code), 462, y + 7, { width: 89, align: "right" });
  return y + 35;
}

function drawDetails(doc: PDFKit.PDFDocument, options: HandoverPdfOptions) {
  const summary = buildHandoverSummary(options.project);
  let y = addDetailPage(doc);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(17).text("Detailed delivery schedule", MARGIN, y);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("Quantities and budget costs below come directly from the saved costing revision.", MARGIN, y + 25);
  y += 54;
  y = drawSection(doc, options, "Materials to procure", "Full-unit material quantities and consumable cost drivers required by the costing.", summary.materials, y);
  y = drawSection(doc, options, "Subcontract work packages", "Mobilisation is included in the relevant subcontract package budget.", summary.subcontractors, y);
  y = drawSection(doc, options, "Internal labour", "Planned internal labour, surveyor and project-management cost drivers.", summary.labour, y);
  y = drawSection(doc, options, "Equipment", "Planned equipment usage, rentals and equipment shipping.", summary.equipment, y);
  drawSection(doc, options, "Travel, accommodation and haulage", "Travel, hotel, subsistence, delivery and haulage requirements.", summary.logistics, y);
}

function drawFooters(doc: PDFKit.PDFDocument, options: HandoverPdfOptions, generatedLabel: string) {
  const range = doc.bufferedPageRange();
  const reference = clean(options.project.inputs.projectReference) || "Unreferenced project";
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.moveTo(MARGIN, 804).lineTo(PAGE_WIDTH - MARGIN, 804).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.8).text(`INTERNAL & CONFIDENTIAL  |  ${reference}  |  Revision ${revisionLabel(options.project)}`, MARGIN, 813, { width: 330, ellipsis: true });
    doc.text(`Generated ${generatedLabel}  |  Page ${index - range.start + 1} of ${range.count}`, 372, 813, { width: 181, align: "right" });
  }
}

function drawRepeatedDetailHeaders(doc: PDFKit.PDFDocument, options: HandoverPdfOptions) {
  const range = doc.bufferedPageRange();
  for (let index = range.start + 1; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    drawDetailHeader(doc, options);
  }
}

export async function renderHandoverPdf(options: HandoverPdfOptions) {
  const generatedAt = options.generatedAt ?? new Date();
  const generatedLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(generatedAt);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: DETAIL_TOP, right: 0, bottom: 0, left: 0 },
    bufferPages: true,
    info: {
      Title: `${clean(options.project.inputs.projectReference) || "Project"} Project Cost & Delivery Summary`,
      Author: clean(options.company.name),
      Subject: "Internal project cost and delivery handover"
    }
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawOverview(doc, options, generatedLabel);
  drawDetails(doc, options);
  drawRepeatedDetailHeaders(doc, options);
  drawFooters(doc, options, generatedLabel);
  doc.end();
  return complete;
}
