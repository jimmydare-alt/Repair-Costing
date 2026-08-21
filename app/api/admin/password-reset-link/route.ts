import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site password reset requests are not allowed." }, { status: 403 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !publishableKey) return NextResponse.json({ error: "An authenticated company admin session is required." }, { status: 401 });
  if (!serviceRoleKey) return NextResponse.json({ error: "Admin password reset links are not configured on this server yet." }, { status: 503 });

  let body: { userId?: string; companyId?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "The password reset request is not valid JSON." }, { status: 400 });
  }
  if (!body.userId || !uuidPattern.test(body.userId) || !body.companyId || !uuidPattern.test(body.companyId)) {
    return NextResponse.json({ error: "A valid user and company are required." }, { status: 400 });
  }

  const requester = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await requester.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Your secure session is no longer valid." }, { status: 401 });

  const { data: authorisedRows, error: authoriseError } = await requester.rpc("authorize_password_reset", {
    target_user_id: body.userId,
    target_company_id: body.companyId
  });
  const authorised = Array.isArray(authorisedRows) ? authorisedRows[0] : authorisedRows;
  if (authoriseError || !authorised?.email) {
    return NextResponse.json({ error: authoriseError?.message ?? "You are not allowed to reset this user's password." }, { status: 403 });
  }

  const siteUrl = (process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(request.url).origin))
    .replace(/\/$/, "");
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: String(authorised.email),
    options: { redirectTo: `${siteUrl}/auth/reset-password` }
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) return NextResponse.json({ error: linkError?.message ?? "Supabase did not create a reset link." }, { status: 502 });

  const { error: auditError } = await requester.rpc("record_password_reset_link_generated", {
    target_user_id: body.userId,
    target_company_id: body.companyId
  });
  if (auditError) return NextResponse.json({ error: "The reset link was not released because its audit event could not be recorded." }, { status: 500 });

  return NextResponse.json({
    actionLink,
    userName: authorised.full_name || authorised.email
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache"
    }
  });
}
