import { Router, type Request, type Response } from "express";
import { getAdminSupabase, getSupabase } from "../../lib/supabase";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";
import { computeStocktakeVariance } from "../../lib/stocktake-variance";

const router = Router();

async function requireStaffOrAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return void res.status(401).json({ error: "Unauthorized" });
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return void res.status(401).json({ error: "Invalid token" });
  const admin = getAdminSupabase();
  const { data: profile } = await (admin as any).from("users").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "staff") {
    return void res.status(403).json({ error: "Forbidden: staff or admin required" });
  }
  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).userName = profile.name;
  (req as any).admin = admin;
  next();
}

// ─── 1. List Stocktakes ───────────────────────────────────────────────────────
router.get("/admin/stocktakes", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  let query = (admin as any).from("stocktakes").select("*, stocktake_lines(id)").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: stocktakes, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const formatted = (stocktakes ?? []).map((s: any) => ({
    ...s,
    total_lines: s.stocktake_lines?.length ?? 0,
    stocktake_lines: undefined,
  }));
  return res.json({ stocktakes: formatted });
});

// ─── 2. Create Draft Stocktake ────────────────────────────────────────────────
router.post("/admin/stocktakes", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const { title, notes, is_opening_count, posting_date } = req.body;

  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title is required" });
  if (is_opening_count && userRole !== "admin") {
    return res.status(403).json({ error: "Forbidden: only owners can initiate the opening count" });
  }

  const stocktakeNumber = `ST-${Date.now().toString().slice(-6)}`;
  const payload: Record<string, any> = {
    stocktake_number: stocktakeNumber,
    title: String(title).trim(),
    notes: notes ? String(notes).trim() : null,
    status: "draft",
    is_opening_count: Boolean(is_opening_count),
    created_by: user.id,
  };
  // R2: posting_date owner-writable only
  if (userRole === "admin" && posting_date) payload.posting_date = posting_date;

  const { data: st, error } = await (admin as any).from("stocktakes").insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(st);
});

// ─── 3. Get Stocktake Details & Lines (Blind to Snapshots) ────────────────────
router.get("/admin/stocktakes/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { data: stocktake, error: stErr } = await (admin as any).from("stocktakes").select("*").eq("id", id).single();
  if (stErr || !stocktake) return res.status(404).json({ error: "Stocktake not found" });

  const { data: lines } = await (admin as any)
    .from("stocktake_lines")
    .select("id, stocktake_id, variant_id, counter_id, counted_quantity, location_note, created_at, updated_at, users(name)")
    .eq("stocktake_id", id)
    .order("created_at", { ascending: false });

  const variantIds = Array.from(new Set((lines ?? []).map((l: any) => l.variant_id)));
  const { data: variants } = variantIds.length > 0
    ? await (admin as any).from("product_variants").select("id, sku, products(title)").in("id", variantIds)
    : { data: [] };

  const varMap = new Map<string, any>();
  (variants ?? []).forEach((v: any) => varMap.set(v.id, v));

  const safeLines = (lines ?? []).map((l: any) => {
    const v = varMap.get(l.variant_id);
    return {
      id: l.id,
      stocktake_id: l.stocktake_id,
      variant_id: l.variant_id,
      counter_id: l.counter_id,
      counted_quantity: Number(l.counted_quantity),
      location_note: l.location_note ?? null,
      created_at: l.created_at,
      updated_at: l.updated_at,
      sku: v?.sku ?? null,
      product_title: v?.products?.title ?? null,
      counter_name: l.users?.name ?? null,
    };
  });

  return res.json({ stocktake, lines: safeLines });
});

// ─── 4. Update Header (R2: posting_date owner-only) ──────────────────────────
router.patch("/admin/stocktakes/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, notes, posting_date } = req.body;

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = String(title).trim();
  if (notes !== undefined) updates.notes = notes ? String(notes).trim() : null;
  if (posting_date !== undefined) {
    if (userRole !== "admin") return res.status(403).json({ error: "Forbidden: posting_date is owner-writable only" });
    updates.posting_date = posting_date;
  }

  const { data: updated, error } = await (admin as any).from("stocktakes").update(updates).eq("id", id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(updated);
});

// ─── 5. Discard Draft Stocktake ───────────────────────────────────────────────
router.delete("/admin/stocktakes/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { error } = await (admin as any).from("stocktakes").delete().eq("id", id).eq("status", "draft");
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
});

// ─── 6. Variance Review & Shrinkage Report (Owner-Only) ──────────────────────
router.get("/admin/stocktakes/:id/variance", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const report = await computeStocktakeVariance(admin, id);
    return res.json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── 7. Resolve Multi-Counter Duplicate Scans (Owner-Only) ────────────────────
router.post("/admin/stocktakes/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { variant_id, resolution_type, chosen_line_id, resolved_quantity } = req.body;

  if (!variant_id || !["sum", "override"].includes(resolution_type) || typeof resolved_quantity !== "number") {
    return res.status(400).json({ error: "Invalid resolution payload" });
  }

  const { data: lines, error: linesErr } = await (admin as any)
    .from("stocktake_lines")
    .select("created_at")
    .eq("stocktake_id", id)
    .eq("variant_id", variant_id);

  if (linesErr) return res.status(400).json({ error: linesErr.message });

  const resolvedLineCount = (lines ?? []).length;
  const resolvedLatestLineAt = lines && lines.length > 0
    ? new Date(Math.max(...lines.map((l: any) => new Date(l.created_at).getTime()))).toISOString()
    : new Date().toISOString();

  const { error } = await (admin as any).from("stocktake_resolutions").upsert({
    stocktake_id: id,
    variant_id,
    resolution_type,
    chosen_line_id: chosen_line_id ?? null,
    resolved_quantity,
    resolved_line_count: resolvedLineCount,
    resolved_latest_line_at: resolvedLatestLineAt,
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
  });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
});

// ─── 8. Set Opening Costs (Owner-Only) ────────────────────────────────────────
router.post("/admin/stocktakes/:id/opening-costs", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { costs } = req.body;
  if (!Array.isArray(costs)) return res.status(400).json({ error: "costs array is required" });

  const rows = costs.map((c: any) => ({
    stocktake_id: id,
    variant_id: c.variant_id,
    opening_unit_cost: Number(c.opening_unit_cost),
  }));

  const { error } = await (admin as any).from("stocktake_opening_costs").upsert(rows);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
});

// ─── 9. Atomically Post Stocktake (Owner-Only) ───────────────────────────────
router.post("/admin/stocktakes/:id/post", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { error } = await (admin as any).rpc("post_stocktake", {
    p_stocktake_id: id,
    p_actor_id: user?.id,
  });
  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user?.id, action: "post_stocktake", entityType: "stocktake", entityId: id, details: {} });
  return res.json({ success: true });
});

export default router;
