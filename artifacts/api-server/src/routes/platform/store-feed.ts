/**
 * Store-feed routes — endpoints called BY a Store using its Per_Store_Credential.
 *
 * These are NOT guarded by `requireSuperAdmin`; they are guarded by
 * Per_Store_Credential verification (the Store calls with its own secret).
 *
 * Endpoints:
 *   GET /platform/store-status — returns the calling Store's platform_status
 *   GET /platform/store-feed/notifications — caller's notifications + unread count
 *   POST /platform/store-feed/notifications/:id/read — mark notification as read
 *
 * Feature: super-admin-platform
 * Requirements: 3.3, 3.4, 5.5, 7.1, 7.3, 7.4, 7.5, 7.6, 7.8, 8.8
 */
import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { getStoreFeed, validateMarkRead } from "../../lib/notifications/feed";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Per_Store_Credential verification (constant-time)
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison using Node's timingSafeEqual.
 * Avoids leaking length information.
 */
function safeCompare(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  if (provided.length === 0) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    // Compare against padded buffer to avoid leaking length info
    const bPadded = Buffer.alloc(a.length);
    b.copy(bPadded, 0, 0, Math.min(b.length, a.length));
    timingSafeEqual(a, bPadded);
    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * Verify Per_Store_Credential from the request headers.
 * Returns the store row on success, or null on failure (with response already sent).
 */
async function verifyStoreCredential(
  req: Request,
  res: Response,
): Promise<{ id: string; platform_status: string } | null> {
  const storeId = req.headers["x-store-id"] as string | undefined;
  const authHeader = req.headers.authorization;

  // Missing store id or bearer
  if (!storeId) {
    res.status(401).json({ error: "authentication required" });
    return null;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "authentication required" });
    return null;
  }

  const bearerSecret = authHeader.slice(7);
  if (!bearerSecret) {
    res.status(401).json({ error: "authentication required" });
    return null;
  }

  // Look up the store by id in the Control_Plane database
  const cp = getControlPlaneSupabase();
  const { data: store, error } = await cp
    .from("stores")
    .select("id, per_store_credential_hash, platform_status")
    .eq("id", storeId)
    .single();

  if (error || !store) {
    // Store not found or DB error — return 403 (don't reveal whether store exists)
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  // Constant-time compare the provided bearer against the stored credential hash
  if (!safeCompare(bearerSecret, store.per_store_credential_hash)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return { id: store.id, platform_status: store.platform_status };
}

// ---------------------------------------------------------------------------
// GET /platform/store-status
// ---------------------------------------------------------------------------

router.get(
  "/platform/store-status",
  async (req: Request, res: Response): Promise<void> => {
    const store = await verifyStoreCredential(req, res);
    if (!store) return;

    res.json({ platform_status: store.platform_status });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/store-feed/notifications
// Returns the calling Store's notifications + unread count, newest-first with
// id tie-break. Registered BEFORE the :id param route.
// Requirements: 7.1, 7.3, 7.5, 7.6, 7.8, 8.8
// ---------------------------------------------------------------------------

router.get(
  "/platform/store-feed/notifications",
  async (req: Request, res: Response): Promise<void> => {
    const store = await verifyStoreCredential(req, res);
    if (!store) return;

    const cp = getControlPlaneSupabase();

    // Fetch all notifications, targets, and reads from control-plane DB
    const [notificationsResult, targetsResult, readsResult] = await Promise.all([
      cp.from("platform_notifications").select("id, content, created_at"),
      cp.from("platform_notification_targets").select("notification_id, store_id"),
      cp.from("platform_notification_reads").select("notification_id, store_id"),
    ]);

    const notifications = notificationsResult.data ?? [];
    const targets = targetsResult.data ?? [];
    const reads = readsResult.data ?? [];

    // Use pure function to compute the feed for this store
    const feed = getStoreFeed({
      storeId: store.id,
      notifications,
      targets,
      reads,
    });

    res.json({ data: feed.items, unread_count: feed.unread_count });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/store-feed/notifications/:id/read
// Mark a notification as read for the calling Store.
// Requirements: 7.3, 7.4
// ---------------------------------------------------------------------------

router.post(
  "/platform/store-feed/notifications/:id/read",
  async (req: Request, res: Response): Promise<void> => {
    const store = await verifyStoreCredential(req, res);
    if (!store) return;

    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const notificationId = raw;

    const cp = getControlPlaneSupabase();

    // Fetch notifications and targets for validation
    const [notificationsResult, targetsResult] = await Promise.all([
      cp.from("platform_notifications").select("id, content, created_at"),
      cp.from("platform_notification_targets").select("notification_id, store_id"),
    ]);

    const notifications = notificationsResult.data ?? [];
    const targets = targetsResult.data ?? [];

    // Validate the mark-read request using the pure function
    const result = validateMarkRead({
      notificationId,
      storeId: store.id,
      targets,
      notifications,
    });

    if (!result.success) {
      res.status(result.httpStatus).json({ error: result.error });
      return;
    }

    // Upsert into platform_notification_reads
    await cp.from("platform_notification_reads").upsert(
      {
        notification_id: notificationId,
        store_id: store.id,
        read_at: new Date().toISOString(),
      },
      { onConflict: "notification_id,store_id" },
    );

    res.json({ data: { read: true } });
  },
);

export default router;
