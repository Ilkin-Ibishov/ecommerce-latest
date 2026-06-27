import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";
import { resolveSupabaseEnv } from "./env";

const { url, anonKey, serviceKey } = resolveSupabaseEnv(process.env);

export function getSupabase(accessToken?: string): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getAdminSupabase(): SupabaseClient<Database> {
  // SEC-006: fail fast instead of silently falling back to the anon key. A
  // missing service-role key must never yield an anon "admin" client subject to
  // RLS — that is a misconfiguration we want to surface loudly, not degrade.
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function requireAdmin(req: any): Promise<{ user: any; admin: any } | null> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getAdminSupabase();
  const { data: profile } = await (admin as any).from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  return { user, admin };
}
