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
  const { data: profile } = await (admin as any).from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "staff") {
    res.status(403).json({ error: "Forbidden: staff or admin required" });
    return;
  }
  (req as any).user = user;
  (req as any).userRole = profile.role;
  (req as any).admin = admin;
  next();
}

// ─── Add Line to Draft Receipt ───────────────────────────────────────────────
router.post("/admin/receipts/:id/lines", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { variant_id, quantity, unit_cost, sort_order } = req.body;

  if (!variant_id || typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ error: "Valid variant_id and positive quantity are required" });
  }

  const { data: receipt } = await (admin as any).from("goods_receipts").select("status").eq("id", receiptId).single();
  if (!receipt || receipt.status !== "draft") return res.status(400).json({ error: "Receipt is not in draft status" });

  const { data: line, error } = await (admin as any)
    .from("goods_receipt_lines")
    .insert({
      receipt_id: receiptId,
      variant_id,
      quantity,
      sort_order: sort_order ?? 0,
    })
    .select("id, receipt_id, variant_id, quantity, sort_order, created_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (userRole === "admin" && typeof unit_cost === "number" && unit_cost >= 0) {
    await (admin as any).from("goods_receipt_line_costs").insert({
      line_id: line.id,
      unit_cost,
    });
  }

  return res.status(201).json({ ...line, ...(userRole === "admin" ? { unit_cost: unit_cost ?? null } : {}) });
});

// ─── Update Draft Line ───────────────────────────────────────────────────────
router.patch("/admin/receipts/:id/lines/:lineId", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const lineId = Array.isArray(req.params.lineId) ? req.params.lineId[0] : req.params.lineId;
  const { quantity, unit_cost, sort_order } = req.body;

  const { data: receipt } = await (admin as any).from("goods_receipts").select("status").eq("id", receiptId).single();
  if (!receipt || receipt.status !== "draft") return res.status(400).json({ error: "Receipt is not in draft status" });

  const lineUpdates: Record<string, unknown> = {};
  if (quantity !== undefined) {
    if (typeof quantity !== "number" || quantity <= 0) return res.status(400).json({ error: "Quantity must be positive" });
    lineUpdates.quantity = quantity;
  }
  if (sort_order !== undefined) lineUpdates.sort_order = sort_order;

  if (Object.keys(lineUpdates).length > 0) {
    const { error } = await (admin as any).from("goods_receipt_lines").update(lineUpdates).eq("id", lineId);
    if (error) return res.status(400).json({ error: error.message });
  }

  if (userRole === "admin" && unit_cost !== undefined) {
    if (typeof unit_cost === "number" && unit_cost >= 0) {
      await (admin as any).from("goods_receipt_line_costs").upsert({ line_id: lineId, unit_cost });
    }
  }

  return res.json({ success: true });
});

// ─── Delete Draft Line ───────────────────────────────────────────────────────
router.delete("/admin/receipts/:id/lines/:lineId", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const lineId = Array.isArray(req.params.lineId) ? req.params.lineId[0] : req.params.lineId;

  const { data: receipt } = await (admin as any).from("goods_receipts").select("status").eq("id", receiptId).single();
  if (!receipt || receipt.status !== "draft") return res.status(400).json({ error: "Receipt is not in draft status" });

  const { error } = await (admin as any).from("goods_receipt_lines").delete().eq("id", lineId);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
