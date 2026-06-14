import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { queueNotification } from "../../lib/notifications";
import { sendWhatsAppTestMessage, isWhatsAppConfigured, getWhatsAppInstance } from "../../lib/whatsapp";

const router = Router();

router.get("/admin/whatsapp/status", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  return res.json({
    configured: isWhatsAppConfigured(),
    instance: getWhatsAppInstance(),
  });
});

router.post("/admin/whatsapp/test", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone is required" });
  const result = await sendWhatsAppTestMessage(phone);
  return res.json(result);
});

router.post("/admin/notifications/:id/retry", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { data: notif } = await (ctx.admin as any)
    .from("notifications")
    .select("*")
    .eq("id", rawId)
    .single();
  if (!notif) return res.status(404).json({ error: "Notification not found" });
  // Re-queue using existing infrastructure — fire and forget
  queueNotification({
    userId: notif.user_id ?? undefined,
    type: notif.type,
    recipient: notif.recipient,
    payload: notif.payload,
  }).catch(() => {});
  return res.json({ success: true });
});

export default router;
