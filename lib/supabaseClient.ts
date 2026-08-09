"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let browserClient: SupabaseClient<any, "public", any> | null | undefined;

export function isSupabaseConfigured() {
  return Boolean(url && publishableKey);
}

export function createBrowserSupabaseClient(): SupabaseClient<any, "public", any> | null {
  if (!url || !publishableKey) return null;
  if (browserClient) return browserClient;
  browserClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });
  return browserClient;
}
