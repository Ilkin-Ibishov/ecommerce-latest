import type { Request, Response, NextFunction } from "express";
import { getAdminSupabase, getSupabase } from "../lib/supabase";

// Staff or owner session. Attaches req.user, req.admin (service-role client) and req.userRole.
// Six M2 route files still carry their own copy of this check; migrating them is listed as
// debt in docs/audits/m3-implementation-notes.md (M3a design note §3, audit A9).
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
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  const role = profile?.role;
  if (role !== "admin" && role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }
  req.user = { id: user.id };
  req.admin = admin;
  req.userRole = role;
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
