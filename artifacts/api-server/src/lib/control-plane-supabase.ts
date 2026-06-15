/**
 * Control_Plane Supabase client (R9.1, R9.7, R9.8).
 *
 * Returns a typed SupabaseClient bound to the CONTROL_PLANE database only —
 * never a store DB. This is the ONLY client that `routes/platform/*` may use.
 *
 * The existing `getSupabase()`/`getAdminSupabase()` (store database) are
 * unchanged and are never used by platform routes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneDatabase } from "@workspace/supabase-types";
import { resolveControlPlaneEnv } from "./env";

const { url, serviceKey } = resolveControlPlaneEnv(process.env);

/**
 * Returns a Supabase client connected to the Control_Plane database.
 * Uses the service-role key for full access (server-side only).
 * Auth: no autoRefresh, no persistSession (mirrors the store client pattern).
 */
export function getControlPlaneSupabase(): SupabaseClient<ControlPlaneDatabase> {
  return createClient<ControlPlaneDatabase>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
