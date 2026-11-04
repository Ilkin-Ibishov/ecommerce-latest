import { Router, type Request, type Response } from "express";
import { getAdminSupabase, getSupabase } from "../../lib/supabase";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";

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

// ─── 1. List Receipts ────────────────────────────────────────────────────────
router.get("/admin/receipts", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  let query = (admin as any)
    .from("goods_receipts")
    .select(`
      id, receipt_number, posting_date, reference_note, note, status, transaction_id, created_at, updated_at,
      suppliers (id, name),
      goods_receipt_lines (id, quantity)
    `)
    .order("posting_date", { ascending: false });

  if (status) query = query.eq("status", status);
  const { data: receipts, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const costsMap = new Map<string, number>();
  const additionalCostsMap = new Map<string, number>();

  if (userRole === "admin" && receipts && receipts.length > 0) {
    const ids = receipts.map((r: any) => r.id);
    const { data: addlCosts } = await (admin as any)
      .from("goods_receipt_costs")
      .select("receipt_id, additional_costs")
      .in("receipt_id", ids);
    (addlCosts ?? []).forEach((c: any) => additionalCostsMap.set(c.receipt_id, Number(c.additional_costs ?? 0)));

    const allLineIds = receipts.flatMap((r: any) => (r.goods_receipt_lines ?? []).map((l: any) => l.id));
    if (allLineIds.length > 0) {
      const { data: lineCosts } = await (admin as any)
        .from("goods_receipt_line_costs")
        .select("line_id, unit_cost")
        .in("line_id", allLineIds);
      (lineCosts ?? []).forEach((lc: any) => costsMap.set(lc.line_id, Number(lc.unit_cost ?? 0)));
    }
  }

  const results = (receipts ?? []).map((r: any) => {
    const lines = r.goods_receipt_lines ?? [];
    const totalQty = lines.reduce((sum: number, l: any) => sum + Number(l.quantity ?? 0), 0);
    let totalCost: number | null = null;
    if (userRole === "admin") {
      const lineCostSum = lines.reduce((sum: number, l: any) => sum + (Number(l.quantity ?? 0) * (costsMap.get(l.id) ?? 0)), 0);
      totalCost = Number((lineCostSum + (additionalCostsMap.get(r.id) ?? 0)).toFixed(2));
    }
    return {
      id: r.id,
      receipt_number: r.receipt_number,
      supplier_id: r.suppliers?.id ?? null,
      supplier_name: r.suppliers?.name ?? null,
      posting_date: r.posting_date,
      reference_note: r.reference_note,
      note: r.note,
      status: r.status,
      transaction_id: r.transaction_id,
      total_quantity: totalQty,
      ...(userRole === "admin" ? { total_cost: totalCost, additional_costs: additionalCostsMap.get(r.id) ?? 0 } : {}),
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  return res.json(results);
});

// ─── 2. Create Draft Receipt ──────────────────────────────────────────────────
router.post("/admin/receipts", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const { supplier_id, posting_date, reference_note, note, additional_costs } = req.body;

  const receiptNumber = `GR-${Date.now().toString(36).toUpperCase()}`;
  const { data: receipt, error } = await (admin as any)
    .from("goods_receipts")
    .insert({
      receipt_number: receiptNumber,
      supplier_id: supplier_id || null,
      posting_date: posting_date || new Date().toISOString(),
      reference_note: reference_note ? String(reference_note).trim() : null,
      note: note ? String(note).trim() : null,
      status: "draft",
      created_by: user.id,
    })
    .select("id, receipt_number, supplier_id, posting_date, reference_note, note, status, created_at, updated_at")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (userRole === "admin" && typeof additional_costs === "number" && additional_costs >= 0) {
    await (admin as any).from("goods_receipt_costs").insert({ receipt_id: receipt.id, additional_costs });
  }

  writeAudit({ admin, req, actorId: user.id, action: "create_goods_receipt", entityType: "goods_receipt", entityId: receipt.id, details: req.body });
  return res.status(201).json(receipt);
});

// ─── 3. Get Receipt Detail with Lines ─────────────────────────────────────────
router.get("/admin/receipts/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const userRole = (req as any).userRole;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { data: receipt, error } = await (admin as any)
    .from("goods_receipts")
    .select(`
      id, receipt_number, supplier_id, posting_date, reference_note, note, status, transaction_id, created_at, updated_at,
      suppliers (id, name),
      goods_receipt_lines (
        id, receipt_id, variant_id, quantity, sort_order, created_at,
        product_variants (
          id, sku, price, unit_of_measure,
          products (id, title, product_translations (lang_code, title))
        )
      )
    `)
    .eq("id", id)
    .single();

  if (error || !receipt) return res.status(404).json({ error: "Goods receipt not found" });

  let addlCosts = 0;
  const lineCostsMap = new Map<string, number>();

  if (userRole === "admin") {
    const { data: ac } = await (admin as any).from("goods_receipt_costs").select("additional_costs").eq("receipt_id", id).maybeSingle();
    if (ac?.additional_costs != null) addlCosts = Number(ac.additional_costs);

    const lineIds = (receipt.goods_receipt_lines ?? []).map((l: any) => l.id);
    if (lineIds.length > 0) {
      const { data: lcs } = await (admin as any).from("goods_receipt_line_costs").select("line_id, unit_cost").in("line_id", lineIds);
      (lcs ?? []).forEach((lc: any) => lineCostsMap.set(lc.line_id, Number(lc.unit_cost)));
    }
  }

  let totalQty = 0;
  let totalCostSum = 0;

  const lines = (receipt.goods_receipt_lines ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((l: any) => {
      const pv = l.product_variants;
      const prod = pv?.products;
      const title = prod?.product_translations?.find((t: any) => t.lang_code === "az")?.title ?? prod?.title ?? "Product";
      const qty = Number(l.quantity);
      totalQty += qty;

      const unitCost = userRole === "admin" ? (lineCostsMap.get(l.id) ?? null) : null;
      const lineTotalCost = unitCost != null ? Number((qty * unitCost).toFixed(2)) : null;
      if (lineTotalCost != null) totalCostSum += lineTotalCost;

      return {
        id: l.id,
        receipt_id: l.receipt_id,
        variant_id: l.variant_id,
        sku: pv?.sku ?? null,
        product_title: title,
        quantity: qty,
        sort_order: l.sort_order,
        ...(userRole === "admin" ? { unit_cost: unitCost, total_cost: lineTotalCost } : {}),
        created_at: l.created_at,
      };
    });

  return res.json({
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    supplier_id: receipt.suppliers?.id ?? null,
    supplier_name: receipt.suppliers?.name ?? null,
    posting_date: receipt.posting_date,
    reference_note: receipt.reference_note,
    note: receipt.note,
    status: receipt.status,
    transaction_id: receipt.transaction_id,
    total_quantity: totalQty,
    ...(userRole === "admin" ? { total_cost: Number((totalCostSum + addlCosts).toFixed(2)), additional_costs: addlCosts } : {}),
    lines,
    created_at: receipt.created_at,
    updated_at: receipt.updated_at,
  });
});

// ─── 4. Update Draft Header ──────────────────────────────────────────────────
router.patch("/admin/receipts/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const userRole = (req as any).userRole;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { supplier_id, posting_date, reference_note, note, additional_costs } = req.body;

  const { data: cur } = await (admin as any).from("goods_receipts").select("status").eq("id", id).single();
  if (!cur || cur.status !== "draft") return res.status(400).json({ error: "Only draft receipts can be modified" });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (supplier_id !== undefined) updates.supplier_id = supplier_id || null;
  if (posting_date) updates.posting_date = posting_date;
  if (reference_note !== undefined) updates.reference_note = reference_note ? String(reference_note).trim() : null;
  if (note !== undefined) updates.note = note ? String(note).trim() : null;

  const { data: updated, error } = await (admin as any).from("goods_receipts").update(updates).eq("id", id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (userRole === "admin" && additional_costs !== undefined) {
    if (typeof additional_costs === "number" && additional_costs >= 0) {
      await (admin as any).from("goods_receipt_costs").upsert({ receipt_id: id, additional_costs });
    }
  }

  writeAudit({ admin, req, actorId: user.id, action: "update_goods_receipt", entityType: "goods_receipt", entityId: id, details: updates });
  return res.json(updated);
});

// ─── 5. Delete Draft Receipt ─────────────────────────────────────────────────
router.delete("/admin/receipts/:id", requireStaffOrAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { data: cur } = await (admin as any).from("goods_receipts").select("status").eq("id", id).single();
  if (!cur || cur.status !== "draft") return res.status(400).json({ error: "Only draft receipts can be discarded" });

  const { error } = await (admin as any).from("goods_receipts").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user.id, action: "delete_goods_receipt", entityType: "goods_receipt", entityId: id, details: {} });
  return res.json({ success: true });
});

// ─── 6. Post Goods Receipt (Admin Only) ───────────────────────────────────────
router.post("/admin/receipts/:id/post", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { error } = await (admin as any).rpc("post_goods_receipt", {
    p_receipt_id: id,
    p_actor_id: user?.id,
  });

  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user?.id, action: "post_goods_receipt", entityType: "goods_receipt", entityId: id, details: {} });
  return res.json({ success: true });
});

// ─── 7. Reverse Goods Receipt (Admin Only) ──────────────────────────────────
router.post("/admin/receipts/:id/reverse", requireAdmin, async (req: Request, res: Response) => {
  const admin = (req as any).admin;
  const user = (req as any).user;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const reason = req.body?.reason ? String(req.body.reason).trim() : "Clerical error correction";

  const { error } = await (admin as any).rpc("reverse_goods_receipt", {
    p_receipt_id: id,
    p_actor_id: user?.id,
    p_reason: reason,
  });

  if (error) return res.status(400).json({ error: error.message });

  writeAudit({ admin, req, actorId: user?.id, action: "reverse_goods_receipt", entityType: "goods_receipt", entityId: id, details: { reason } });
  return res.json({ success: true });
});

export default router;
