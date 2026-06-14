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
  return createClient<Database>(url, serviceKey || anonKey, {
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
