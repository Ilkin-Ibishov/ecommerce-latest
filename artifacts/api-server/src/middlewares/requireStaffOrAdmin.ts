import type { Request, Response, NextFunction } from "express";
import { getAdminSupabase, getSupabase } from "../lib/supabase";

// Staff or owner session. Attaches req.user, req.admin (service-role client), req.userRole and req.userName.
export async function requireStaffOrAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { data: { user } } = await getSupabase(token).auth.getUser();
  if (!user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const admin = getAdminSupabase();
  const { data: profile } = await admin.from("users").select("role, full_name").eq("id", user.id).maybeSingle();
  const rawRole = profile?.role || (user.app_metadata?.role as string) || (user.user_metadata?.role as string);
  const role = typeof rawRole === "string" ? rawRole.toLowerCase() : "";
  if (role !== "admin" && role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }
  req.user = { id: user.id, email: user.email };
  (req as any).userName = profile?.full_name ?? (user.user_metadata?.full_name as string) ?? user.email ?? "Staff";
  req.admin = admin;
  req.userRole = role as "admin" | "staff";
  next();
}

// Use after requireStaffOrAdmin on owner-only routes.
export function ownerOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden: owner only" });
    return;
  }
  next();
}
