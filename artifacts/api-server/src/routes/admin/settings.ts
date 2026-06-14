import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";

const router = Router();

router.get("/admin/settings", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { data } = await (ctx.admin as any)
    .from("store_settings").select("key, value, description").order("key");
  const settings: Record<string, string> = {};
  (data ?? []).forEach((row: any) => { settings[row.key] = row.value; });
  return res.json(settings);
});

router.patch("/admin/settings", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return res.status(400).json({ error: "Body must be a key-value object" });
  }
  const rows = Object.entries(updates).map(([key, value]) => ({
    key, value: String(value), updated_at: new Date().toISOString(),
  }));
  await (ctx.admin as any).from("store_settings").upsert(rows, { onConflict: "key" });
  writeAudit({
    admin: ctx.admin, req,
    actorId: ctx.user.id, action: "update_settings",
    entityType: "store_settings", entityId: null, details: updates,
  });
  return res.json({ success: true });
});

export default router;
