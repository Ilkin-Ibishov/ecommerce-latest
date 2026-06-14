import type { Request, Response, NextFunction } from "express";
import { requireAdmin as resolveAdmin } from "../lib/supabase";

// requireAdmin: reproduces the prior inline outcome — 403 when the request does
// not resolve to an admin context. Reuses the existing admin-resolution logic in
// lib/supabase.ts (aliased as `resolveAdmin`) to avoid a naming clash and keep
// behavior identical to the current inline `requireAdmin(req)` checks.
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = await resolveAdmin(req); // same logic as today's requireAdmin(req)
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" }); // IDENTICAL to prior inline check
    return;
  }
  req.user = ctx.user;
  req.admin = ctx.admin;
  next();
}
