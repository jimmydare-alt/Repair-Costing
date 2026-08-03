"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isSupabaseConfigured() {
  return Boolean(url && publishableKey);
}

export function createBrowserSupabaseClient() {
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });
}

