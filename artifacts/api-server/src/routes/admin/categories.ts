import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

router.post("/admin/categories", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { slug, icon_url, parent_id, translations } = req.body;
  const admin = ctx.admin;
  const { data: cat, error } = await (admin as any).from("categories").insert({ slug, icon_url: icon_url ?? null, parent_id: parent_id ?? null }).select("id").single();
  if (error) return res.status(400).json({ error: error.message });
  if (translations?.length) await (admin as any).from("category_translations").insert(translations.map((t: any) => ({ ...t, category_id: cat.id })));
  return res.status(201).json({ id: cat.id });
});

router.patch("/admin/categories/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { id } = req.params;
  const { slug, icon_url, parent_id, translations } = req.body;
  const admin = ctx.admin;
  await (admin as any).from("categories").update({ slug, icon_url: icon_url ?? null, parent_id: parent_id ?? null }).eq("id", id);
  await (admin as any).from("category_translations").delete().eq("category_id", id);
  if (translations?.length) await (admin as any).from("category_translations").insert(translations.map((t: any) => ({ ...t, category_id: id })));
  return res.json({ success: true });
});

router.delete("/admin/categories/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  await (ctx.admin as any).from("categories").delete().eq("id", req.params.id);
  return res.json({ success: true });
});

export default router;
