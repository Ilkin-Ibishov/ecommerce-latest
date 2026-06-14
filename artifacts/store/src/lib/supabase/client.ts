import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { resolveSupabaseEnv } from "../env";

const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveSupabaseEnv(
  import.meta.env as Record<string, string | undefined>
);

let _client: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn("[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars.");
    }
    _client = createBrowserClient<Database>(
      SUPABASE_URL || "https://placeholder.supabase.co",
      SUPABASE_ANON_KEY || "placeholder-key"
    );
  }
  return _client;
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}
