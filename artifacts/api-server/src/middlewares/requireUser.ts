import type { Request, Response, NextFunction } from "express";
import { getSupabase } from "../lib/supabase";

// requireUser: reproduces the prior inline 401 outcome — the user-token
// boilerplate that repeats across routes like cart.ts / orders.ts. Extracts the
// bearer token, resolves the user via Supabase auth, and short-circuits with the
// IDENTICAL `401 { error: "Unauthorized" }` shape the inline checks emit today.
// On success it attaches `req.authUser = { id }` and calls next().
export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" }); // IDENTICAL to prior inline check
    return;
  }
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    res.status(401).json({ error: "Unauthorized" }); // IDENTICAL to prior inline check
    return;
  }
  req.authUser = { id: user.id };
  next();
}
