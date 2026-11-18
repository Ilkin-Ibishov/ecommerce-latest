import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";
import { logger } from "../../lib/logger";
import {
  itemsForRole,
  countResponseSchema,
  inboxResponseSchema,
} from "../../lib/inbox";
import { fetchNeedsYouCounts, fetchAdminEvents } from "../../lib/inbox-queries";

const router = Router();

function parseOutput<T>(req: Request, res: Response, schema: z.ZodType<T>, data: unknown, label: string): T | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    (req.log || logger).error({ issues: parsed.error.issues }, `Failed to parse ${label}`);
    res.status(500).json({ error: "Failed to parse inbox data" });
    return null;
  }
  return parsed.data;
}

router.get("/admin/inbox/count", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const role = req.userRole;
  const counts = await fetchNeedsYouCounts(admin, role);
  const keys = itemsForRole(role);
  let total = keys.reduce((sum, key) => sum + counts[key], 0);

  if (role === "admin") {
    const { events } = await fetchAdminEvents(admin, req.user!.id);
    total += events.filter((e) => e.unread).length;
  }

  const parsed = parseOutput(req, res, countResponseSchema, { count: total }, "inbox count");
  if (!parsed) return;
  res.json(parsed);
  return;
});

router.get("/admin/inbox", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const role = req.userRole;
  const counts = await fetchNeedsYouCounts(admin, role);
  const keys = itemsForRole(role);
  const needs_you = keys.map((key) => ({ key, count: counts[key] }));

  if (role === "admin") {
    const { events, seenAt } = await fetchAdminEvents(admin, req.user!.id);
    const parsed = parseOutput(req, res, inboxResponseSchema, { needs_you, events, seen_at: seenAt }, "admin inbox");
    if (!parsed) return;
    res.json(parsed);
    return;
  }

  const { data: markerRow } = await admin.from("admin_inbox_seen").select("seen_at").eq("user_id", req.user!.id).maybeSingle();
  const parsed = parseOutput(req, res, inboxResponseSchema, { needs_you, events: null, seen_at: markerRow?.seen_at ?? null }, "staff inbox");
  if (!parsed) return;
  res.json(parsed);
  return;
});

router.post("/admin/inbox/seen", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  await admin.from("admin_inbox_seen").upsert({
    user_id: req.user!.id,
    seen_at: new Date().toISOString(),
  });
  res.status(204).end();
  return;
});

export default router;
