import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHandoverPdf } from "@/lib/handoverPdf";
import type { ProjectRecord } from "@/lib/types";
import { normaliseProjectStatus } from "@/lib/workflow";

export const runtime = "nodejs";

type BrandingStorageClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
    };
  };
};

async function loadCompanyLogo(client: BrandingStorageClient, company: Record<string, unknown>) {
  const customPath = company.branding_status === "approved" ? String(company.logo_path ?? "") : "";
  if (customPath) {
    const { data, error } = await client.storage.from("company-branding").download(customPath);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  }
  const fallback = String(company.name ?? "").toLowerCase().includes("face") ? "face-logo.png" : "cogri-group-logo.png";
  try {
    return await readFile(join(process.cwd(), "public", fallback));
  } catch {
    return undefined;
  }
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
  let body: { projectId?: string };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "The handover request is not valid JSON." }, { status: 400 });
  }
  if (!body.projectId || body.projectId.length > 200) return NextResponse.json({ error: "A valid saved project is required." }, { status: 400 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return NextResponse.json({ error: "An authenticated company session is required." }, { status: 401 });
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Your secure session is no longer valid." }, { status: 401 });
  const { data: projectRow, error: projectError } = await client.from("projects").select("*").eq("id", body.projectId).maybeSingle();
  if (projectError || !projectRow) return NextResponse.json({ error: "The project was not found or is not available to your company account." }, { status: 404 });
  const project = {
    id: String(projectRow.id),
    companyId: String(projectRow.company_id),
    createdAt: String(projectRow.created_at),
    status: projectRow.status,
    accountsStatus: projectRow.accounts_status,
    inputs: projectRow.inputs,
    calculations: projectRow.calculations,
    actuals: projectRow.actuals,
    revisions: projectRow.revisions,
    notes: projectRow.notes,
    changeLog: projectRow.change_log
  } as ProjectRecord;
  if (!Array.isArray(project.calculations?.budgetLines) || !Number.isFinite(project.calculations?.budgetCost)) return NextResponse.json({ error: "The saved project costing is incomplete." }, { status: 409 });
  const { data: companyRow } = await client.from("companies").select("name,logo_path,primary_colour,dark_colour,branding_status").eq("id", project.companyId).maybeSingle();
  const companyName = String(companyRow?.name ?? "CoGri Group");
  if (!["Costing Complete", "Won", "Handover Issued"].includes(normaliseProjectStatus(project.status))) return NextResponse.json({ error: "Complete the costing before generating a handover." }, { status: 409 });
  const company = companyRow as Record<string, unknown> | null;
  const logo = await loadCompanyLogo(client, company ?? { name: companyName });
  const pdf = await renderHandoverPdf({
    project,
    company: {
      name: companyName,
      primaryColour: String(company?.primary_colour ?? "#b91c1c"),
      darkColour: String(company?.dark_colour ?? "#172033"),
      logo
    },
    generatedBy: userData.user.email ?? undefined
  });
  return new NextResponse(new Uint8Array(pdf), { headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${(project.inputs.projectReference || "project").replace(/[^a-z0-9-_]/gi, "-")}-delivery-summary.pdf"`,
    "X-Content-Type-Options": "nosniff"
  } });
}
