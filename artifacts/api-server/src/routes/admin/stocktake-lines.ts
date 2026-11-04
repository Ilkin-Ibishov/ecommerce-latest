import { Router, type Request, type Response } from "express";
import { getAdminSupabase, getSupabase } from "../../lib/supabase";

const router = Router();

async function requireStaffOrAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const supabase = getSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const admin = getAdminSupabase();
  const { data: profile } = await (admin as any).from("users").select("role, name").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }
  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).userName = profile.name;
  (req as any).admin = admin;
  next();
}

// ─── 1. Scan / Add Line to Draft Stocktake ────────────────────────────────────
router.post("/admin/stocktakes/:id/lines", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userName = (req as any).userName;
  const stocktakeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { variant_id, counted_quantity, location_note } = req.body;

  if (!variant_id || typeof counted_quantity !== "number" || counted_quantity < 0) {
    return res.status(400).json({ error: "Valid variant_id and non-negative counted_quantity are required" });
  }

  const { data: st } = await (admin as any).from("stocktakes").select("status").eq("id", stocktakeId).single();
  if (!st || st.status !== "draft") return res.status(400).json({ error: "Stocktake is not in draft status" });

  const { data: variant } = await (admin as any)
    .from("product_variants")
    .select("sku, products(title)")
    .eq("id", variant_id)
    .single();

  const { data: line, error } = await (admin as any)
    .from("stocktake_lines")
    .insert({
      stocktake_id: stocktakeId,
      variant_id,
      counter_id: user.id,
      counted_quantity,
      location_note: location_note ? String(location_note).trim() : null,
    })
    .select("id, stocktake_id, variant_id, counter_id, counted_quantity, location_note, created_at, updated_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Return blind-count response: NO snapshot_on_hand or expected_quantity
  return res.status(201).json({
    ...line,
    sku: variant?.sku ?? null,
    product_title: variant?.products?.title ?? null,
    counter_name: userName ?? null,
  });
});

// ─── 2. Update Line (Typo Fix Workflow - R1) ─────────────────────────────────
router.patch("/admin/stocktakes/:id/lines/:lineId", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const lineId = Array.isArray(req.params.lineId) ? req.params.lineId[0] : req.params.lineId;
  const { counted_quantity, location_note } = req.body;

  if (typeof counted_quantity !== "number" || counted_quantity < 0) {
    return res.status(400).json({ error: "Non-negative counted_quantity is required" });
  }

  const { data: existingLine } = await (admin as any).from("stocktake_lines").select("*").eq("id", lineId).single();
  if (!existingLine) return res.status(404).json({ error: "Line not found" });

  if (userRole === "staff" && existingLine.counter_id !== user.id) {
    return res.status(403).json({ error: "Forbidden: staff can only edit their own count lines" });
  }

  const updatePayload: Record<string, any> = {
    counted_quantity,
    updated_at: new Date().toISOString(),
  };
  if (location_note !== undefined) updatePayload.location_note = location_note ? String(location_note).trim() : null;

  const { data: updated, error } = await (admin as any)
    .from("stocktake_lines")
    .update(updatePayload)
    .eq("id", lineId)
    .select("id, stocktake_id, variant_id, counter_id, counted_quantity, location_note, created_at, updated_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(updated);
});

// ─── 3. Remove Line (Recount Workflow - R1) ──────────────────────────────────
router.delete("/admin/stocktakes/:id/lines/:lineId", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const lineId = Array.isArray(req.params.lineId) ? req.params.lineId[0] : req.params.lineId;

  const { data: existingLine } = await (admin as any).from("stocktake_lines").select("counter_id").eq("id", lineId).single();
  if (!existingLine) return res.status(404).json({ error: "Line not found" });

  if (userRole === "staff" && existingLine.counter_id !== user.id) {
    return res.status(403).json({ error: "Forbidden: staff can only delete their own count lines" });
  }

  const { error } = await (admin as any).from("stocktake_lines").delete().eq("id", lineId);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
