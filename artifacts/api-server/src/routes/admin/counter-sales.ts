import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { PostCounterSaleBody, VoidCounterSaleBody } from "@workspace/api-zod";
import { priceCounterSale, type BundleDefinition } from "@workspace/counter-pricing";
import type { Json } from "@workspace/supabase-types";
import { requireStaffOrAdmin, ownerOnly } from "../../middlewares/requireStaffOrAdmin";
import { writeAudit } from "../../lib/audit";

// Counter sales (M3a design note Q2, §3). Express prices the sale with the shared module and
// posts it through post_counter_sale; the database computes every flag. Staff never see the
// owner-only flags (M3 spec §13), so they are stripped here.
const router = Router();

type Obj = { [k: string]: Json | undefined };
const asObj = (j: Json | null | undefined): Obj => (j && typeof j === "object" && !Array.isArray(j) ? j : {});
const OWNER_ONLY = ["total_mismatch", "price_mismatch", "reservation_override", "posted_after_count", "list_unit_price"];
function forRole(sale: Obj, role: string | undefined): Obj {
  if (role === "admin") return sale;
  const strip = (o: Obj) => Object.fromEntries(Object.entries(o).filter(([k]) => !OWNER_ONLY.includes(k)));
  const lines = Array.isArray(sale.lines) ? sale.lines.map((l) => strip(asObj(l))) : sale.lines;
  return { ...strip(sale), lines };
}

// Database error codes from the counter functions (design note Q2) → HTTP.
const HTTP: Record<string, number> = {
  ST020: 409, ST022: 409, ST025: 409, ST001: 409, ST016: 404,
  ST002: 400, ST023: 400, ST024: 400, ST026: 400,
};
function fail(res: Response, error: { code?: string; message: string }): void {
  res.status(HTTP[error.code ?? ""] ?? 500).json({ error: error.message, code: error.code });
}

router.post("/admin/counter/sales", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = PostCounterSaleBody.safeParse(req.body);
  if (!parsed.success || parsed.data.lines.some((l) => !Number.isInteger(l.quantity))) {
    res.status(400).json({ error: "Invalid sale", details: parsed.success ? "quantities must be whole" : parsed.error.issues });
    return;
  }
  const body = parsed.data;
  const admin = req.admin!;

  // Bundles the cart is tagged with must exist and be active (audit A3.3, A3.5).
  const bundleIds = [...new Set(body.lines.map((l) => l.bundle_id).filter((id): id is string => !!id))];
  let bundles: BundleDefinition[] = [];
  if (bundleIds.length) {
    const { data, error } = await admin.from("bundles")
      .select("id, bundle_price, bundle_lines ( variant_id, quantity )").in("id", bundleIds).eq("is_active", true);
    if (error) return fail(res, error);
    if ((data ?? []).length !== bundleIds.length) {
      res.status(400).json({ error: "Unknown or inactive bundle" });
      return;
    }
    bundles = (data ?? []).map((b) => ({
      id: b.id,
      bundle_price: b.bundle_price === null ? null : Number(b.bundle_price),
      lines: b.bundle_lines.map((bl) => ({ variant_id: bl.variant_id, quantity: bl.quantity })),
    }));
  }

  const lines = body.lines.map((l, i) => ({
    line_no: i + 1, variant_id: l.variant_id, quantity: l.quantity,
    charged_unit_price: l.charged_unit_price, bundle_id: l.bundle_id ?? null,
  }));
  let priced;
  try {
    // A staff session's owner discount is ignored, not rejected (M3 spec §6).
    priced = priceCounterSale(lines, bundles, req.userRole === "admin" ? body.owner_discount : 0);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const sale = {
    id: body.id, sold_at: body.sold_at.toISOString(), payment_method: body.payment_method,
    note: body.note ?? null, displayed_total: body.displayed_total,
    bundle_discount: priced.bundle_discount, owner_discount: priced.owner_discount,
    total_amount: priced.total_amount,
    lines: priced.lines.map((l) => ({
      line_no: l.line_no, variant_id: l.variant_id, quantity: l.quantity,
      charged_unit_price: l.charged_unit_price, bundle_id: l.bundle_id ?? null, net_line_total: l.net_line_total,
    })),
  };
  // Hash of the parsed request, not the priced object, so a resend hashes the same (audit A10.3).
  const hash = createHash("md5").update(JSON.stringify(body)).digest("hex");

  // One retry on deadlock/serialization failure; idempotency makes it safe (audit A7).
  let result = await admin.rpc("post_counter_sale", { p_sale: sale, p_payload_hash: hash, p_session_user: req.user!.id });
  if (result.error && ["40P01", "40001"].includes(result.error.code)) {
    result = await admin.rpc("post_counter_sale", { p_sale: sale, p_payload_hash: hash, p_session_user: req.user!.id });
  }
  if (result.error) return fail(res, result.error);
  const out = asObj(result.data);
  res.status(out.replayed ? 200 : 201).json(forRole(out, req.userRole));
});

router.get("/admin/counter/sales", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  let query = req.admin!.from("counter_sales")
    .select("id, sale_number, sold_at, posting_date, payment_method, total_amount, status, needs_owner_reason, total_mismatch, voided_at, void_reason, cashier:users!counter_sales_cashier_id_fkey ( full_name )")
    .order("posting_date", { ascending: false }).limit(200);
  if (typeof req.query.status === "string") query = query.eq("status", req.query.status);
  const { data, error } = await query;
  if (error) return fail(res, error);
  res.json((data ?? []).map((s) => forRole(s as Obj, req.userRole)));
});

router.get("/admin/counter/sales/:id", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = String(req.params.id);
  const [sale, lines] = await Promise.all([
    admin.from("counter_sales").select("*, cashier:users!counter_sales_cashier_id_fkey ( full_name )").eq("id", id).maybeSingle(),
    admin.from("counter_sale_lines")
      .select("*, product_variants ( sku, products ( product_translations ( lang_code, title ) ) )")
      .eq("sale_id", id).order("line_no"),
  ]);
  if (sale.error) return fail(res, sale.error);
  if (!sale.data) {
    res.status(404).json({ error: "Counter sale not found" });
    return;
  }
  const { payload_hash: _hash, ...header } = sale.data;
  res.json(forRole({ ...(header as Obj), lines: (lines.data ?? []) as Json[] }, req.userRole));
});

router.post("/admin/counter/sales/:id/void", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const parsed = VoidCounterSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A void needs a reason" });
    return;
  }
  const id = String(req.params.id);
  const { data, error } = await req.admin!.rpc("void_counter_sale", { p_id: id, p_reason: parsed.data.reason, p_session_user: req.user!.id });
  if (error) return fail(res, error);
  writeAudit({ admin: req.admin!, req, actorId: req.user!.id, action: "void_counter_sale", entityType: "counter_sale", entityId: id, details: parsed.data });
  res.json(data);
});

router.post("/admin/counter/sales/:id/post-pending", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { data, error } = await req.admin!.rpc("post_pending_counter_sale", { p_id: id, p_session_user: req.user!.id });
  if (error) return fail(res, error);
  writeAudit({ admin: req.admin!, req, actorId: req.user!.id, action: "post_pending_counter_sale", entityType: "counter_sale", entityId: id, details: {} });
  res.json(data);
});

router.get("/admin/counter/flagged", requireStaffOrAdmin, ownerOnly, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const [lines, sales] = await Promise.all([
    admin.from("counter_sale_lines")
      .select("sale_id, line_no, variant_id, quantity, list_unit_price, charged_unit_price, price_mismatch, reservation_override, posted_after_count, counter_sales ( sale_number, posting_date, status )")
      .or("price_mismatch.eq.true,reservation_override.eq.true,posted_after_count.eq.true").limit(500),
    admin.from("counter_sales")
      .select("id, sale_number, posting_date, total_amount, displayed_total, status, needs_owner_reason, total_mismatch")
      .or("status.eq.needs_owner,total_mismatch.eq.true").order("posting_date", { ascending: false }).limit(500),
  ]);
  if (lines.error) return fail(res, lines.error);
  if (sales.error) return fail(res, sales.error);
  res.json({ lines: lines.data, sales: sales.data });
});

export default router;
