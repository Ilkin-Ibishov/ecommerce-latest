/**
 * Control-Plane Supabase browser client.
 * Used exclusively by /platform/* pages to authenticate super admins.
 * Points to the separate Control-Plane Supabase project (NOT the store DB).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const CP_URL = import.meta.env.VITE_CONTROL_PLANE_SUPABASE_URL as string | undefined;
const CP_ANON_KEY = import.meta.env.VITE_CONTROL_PLANE_SUPABASE_ANON_KEY as string | undefined;

let _cpClient: SupabaseClient | null = null;

export function getControlPlaneClient(): SupabaseClient {
  if (!_cpClient) {
    if (!CP_URL || !CP_ANON_KEY) {
      console.warn("[Platform] Missing VITE_CONTROL_PLANE_SUPABASE_URL or VITE_CONTROL_PLANE_SUPABASE_ANON_KEY.");
    }
    _cpClient = createBrowserClient(
      CP_URL || "https://placeholder.supabase.co",
      CP_ANON_KEY || "placeholder-key",
    );
  }
  return _cpClient;
}

export function isControlPlaneConfigured(): boolean {
  return !!(CP_URL && CP_ANON_KEY);
}
