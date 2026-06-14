import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { validate } from "../../middlewares/validate";
import { CreateCouponSchema, UpdateCouponSchema } from "./schemas";

const router = Router();

router.post("/admin/coupons", requireAdmin, validate(CreateCouponSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_user, scope, scope_ids, is_active, starts_at, expires_at } = req.body;
  const { data, error } = await (ctx.admin as any).from("coupons").insert({
    code: code.toUpperCase(), description, discount_type, discount_value,
    min_order_amount: min_order_amount ?? null, max_uses: max_uses ?? null,
    max_uses_per_user: max_uses_per_user ?? null, scope: scope ?? "global",
    scope_ids: scope_ids ?? null, is_active: is_active ?? true,
    starts_at: starts_at ?? null, expires_at: expires_at ?? null, used_count: 0,
  }).select("id").single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ id: data.id });
});

router.patch("/admin/coupons/:id", requireAdmin, validate(UpdateCouponSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_user, scope, scope_ids, is_active, starts_at, expires_at } = req.body;
  await (ctx.admin as any).from("coupons").update({
    code: code?.toUpperCase(), description, discount_type, discount_value,
    min_order_amount: min_order_amount ?? null, max_uses: max_uses ?? null,
    max_uses_per_user: max_uses_per_user ?? null, scope: scope ?? "global",
    scope_ids: scope_ids ?? null, is_active, starts_at: starts_at ?? null, expires_at: expires_at ?? null,
  }).eq("id", req.params.id);
  return res.json({ success: true });
});

router.delete("/admin/coupons/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  await (ctx.admin as any).from("coupons").delete().eq("id", req.params.id);
  return res.json({ success: true });
});

export default router;
