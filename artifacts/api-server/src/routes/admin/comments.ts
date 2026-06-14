import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";

const router = Router();

router.patch("/admin/comments/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { approved } = req.body;
  await (ctx.admin as any).from("comments").update({ approved: !!approved }).eq("id", req.params.id);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "moderate_comment", entityType: "comment", entityId: req.params.id as string, details: { approved } });
  return res.json({ success: true });
});

router.delete("/admin/comments/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  await (ctx.admin as any).from("comments").delete().eq("id", req.params.id);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "delete_comment", entityType: "comment", entityId: req.params.id as string, details: {} });
  return res.json({ success: true });
});

export default router;
