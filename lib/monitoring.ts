"use client";

import { createBrowserSupabaseClient } from "./supabaseClient";

export function errorReference(date = new Date(), random = crypto.randomUUID()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `ERR-${stamp}-${random.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected application error occurred.";
}

export async function reportAppError(options: { companyId?: string; userId?: string; area: string; error: unknown; path?: string }) {
  const reference = errorReference();
  const message = errorMessage(options.error).slice(0, 1500);
  const client = createBrowserSupabaseClient();
  if (!client || !options.companyId || !options.userId) {
    console.error(`[${reference}] ${options.area}: ${message}`);
    return reference;
  }
  const { error } = await client.from("app_error_events").insert({
    reference,
    company_id: options.companyId,
    user_id: options.userId,
    area: options.area.slice(0, 120),
    message,
    path: (options.path ?? (typeof window !== "undefined" ? window.location.pathname : "")).slice(0, 500)
  });
  if (error) console.error(`[${reference}] Error event could not be recorded: ${error.message}`);
  return reference;
}
