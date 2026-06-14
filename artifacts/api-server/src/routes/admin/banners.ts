import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { validate } from "../../middlewares/validate";
import { CreateBannerSchema, UpdateBannerSchema } from "./schemas";
import { writeAudit } from "../../lib/audit";

const router = Router();

router.get("/admin/banners", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { data } = await (ctx.admin as any).from("banners").select("*").order("sort_order");
  return res.json(data ?? []);
});

router.post("/admin/banners", requireAdmin, validate(CreateBannerSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { title, subtitle, image_url, cta_text, cta_url, sort_order, active } = req.body;
  const { data, error } = await (ctx.admin as any).from("banners").insert({
    title, subtitle: subtitle ?? null, image_url: image_url ?? null,
    cta_text: cta_text ?? null, cta_url: cta_url ?? null,
    sort_order: sort_order ?? 0, active: active ?? true,
  }).select("id").single();
  if (error) return res.status(400).json({ error: error.message });
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "create_banner", entityType: "banner", entityId: data.id, details: req.body });
  return res.status(201).json({ id: data.id });
});

router.patch("/admin/banners/:id", requireAdmin, validate(UpdateBannerSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { id } = req.params;
  const { title, subtitle, image_url, cta_text, cta_url, sort_order, active } = req.body;
  await (ctx.admin as any).from("banners").update({
    title, subtitle: subtitle ?? null, image_url: image_url ?? null,
    cta_text: cta_text ?? null, cta_url: cta_url ?? null,
    sort_order: sort_order ?? 0, active: !!active,
  }).eq("id", id);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "update_banner", entityType: "banner", entityId: id as string, details: req.body });
  return res.json({ success: true });
});

router.delete("/admin/banners/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  await (ctx.admin as any).from("banners").delete().eq("id", req.params.id);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "delete_banner", entityType: "banner", entityId: req.params.id as string, details: {} });
  return res.json({ success: true });
});

export default router;
