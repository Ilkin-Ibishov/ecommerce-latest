/**
 * Platform notification routes:
 * - POST /platform/notifications — Send Platform_Message
 * - GET  /platform/stores/:id/notification-preferences — Read per-store delivery prefs
 * - PUT  /platform/stores/:id/notification-preferences — Update per-store delivery prefs
 *
 * Feature: super-admin-platform
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 7.9, 18.3
 *
 * Allows a Super_Admin to send a Platform_Message to a single Store, a set of
 * Stores, or broadcast to all non-disabled Stores. Validates body with Zod,
 * resolves targets via `resolveNotificationTargets`, inserts notification +
 * target rows, audits the send BEFORE returning success.
 *
 * MUST NOT create or store any Store_Event_Notification (R7.9).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { validate } from "../../middlewares/validate";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { resolveNotificationTargets } from "../../lib/notifications/target";
import { writePlatformAudit } from "../../lib/platform/audit";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const SendNotificationSchema = z.object({
  content: z.string({ required_error: "content is required" }),
  targets: z.union([
    z.literal("broadcast"),
    z.array(z.string()).min(1, "targets must contain at least one store id"),
  ]),
});

type SendNotificationBody = z.infer<typeof SendNotificationSchema>;

const UpdatePreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      type: z.string({ required_error: "type is required" }),
      channel: z.enum(["in_app", "email"], {
        required_error: "channel is required",
        invalid_type_error: "channel must be one of: in_app, email",
      }),
      enabled: z.boolean({ required_error: "enabled is required" }),
    }),
  ).min(1, "preferences must contain at least one entry"),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /platform/notifications — Send Platform_Message (R8.1–R8.7, R7.9)
// ---------------------------------------------------------------------------
router.post(
  "/platform/notifications",
  requireSuperAdmin,
  validate(SendNotificationSchema),
  async (req, res): Promise<void> => {
    const body = req.validatedBody as SendNotificationBody;
    const cp = getControlPlaneSupabase();

    // Step 1: Body already validated by validate(schema) middleware above.

    // Step 2: Fetch registered store ids + their platform_status to identify disabled ones.
    const { data: storeRows, error: storeError } = await cp
      .from("stores")
      .select("id, platform_status");

    if (storeError) {
      req.log?.error?.({ err: storeError }, "failed to fetch stores for notification targeting");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const registeredStoreIds = (storeRows ?? []).map((s) => s.id);
    const disabledStoreIds = (storeRows ?? [])
      .filter((s) => s.platform_status === "disabled")
      .map((s) => s.id);

    // Step 3: Resolve notification targets using pure targeting logic.
    const targetingResult = resolveNotificationTargets({
      content: body.content,
      targetStoreIds: body.targets,
      registeredStoreIds,
      disabledStoreIds,
    });

    // Step 4: If result is invalid → return the httpStatus and error (400 or 404).
    if (!targetingResult.valid) {
      res.status(targetingResult.httpStatus).json({ error: targetingResult.error });
      return;
    }

    // Step 5: Insert a `platform_notifications` row.
    const { data: notification, error: insertError } = await cp
      .from("platform_notifications")
      .insert({
        type: "platform_message",
        scope: targetingResult.scope,
        content: body.content,
        created_by: req.superAdmin!.userId,
      })
      .select("id, scope, created_at")
      .single();

    if (insertError || !notification) {
      req.log?.error?.({ err: insertError }, "failed to insert platform_notification");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Step 6: Insert `platform_notification_targets` rows for each resolvedTargetId.
    const targetRows = targetingResult.resolvedTargetIds.map((storeId) => ({
      notification_id: notification.id,
      store_id: storeId,
    }));

    if (targetRows.length > 0) {
      const { error: targetsError } = await cp
        .from("platform_notification_targets")
        .insert(targetRows);

      if (targetsError) {
        req.log?.error?.({ err: targetsError }, "failed to insert notification targets");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
    }

    // Step 7: Audit the send BEFORE returning success (R8.4).
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "send_notification",
      entity: "notification",
      entityId: notification.id,
      changes: {
        scope: targetingResult.scope,
        target_count: targetingResult.resolvedTargetIds.length,
        timestamp: new Date().toISOString(),
      },
    });

    // Step 8: Return 201 with notification summary.
    res.status(201).json({
      data: {
        id: notification.id,
        scope: targetingResult.scope,
        target_count: targetingResult.resolvedTargetIds.length,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/stores/:id/notification-preferences — Read per-store prefs (R18.3)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores/:id/notification-preferences",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const storeId = raw;
    const cp = getControlPlaneSupabase();

    // Verify the store exists.
    const { data: store, error: storeErr } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeErr || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch preferences for this store.
    const { data: prefs, error: prefsErr } = await cp
      .from("notification_preferences")
      .select("type, channel, enabled")
      .eq("store_id", storeId);

    if (prefsErr) {
      req.log?.error?.({ err: prefsErr }, "failed to fetch notification preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ data: prefs ?? [] });
  },
);

// ---------------------------------------------------------------------------
// PUT /platform/stores/:id/notification-preferences — Update per-store prefs (R18.3)
// ---------------------------------------------------------------------------
router.put(
  "/platform/stores/:id/notification-preferences",
  requireSuperAdmin,
  validate(UpdatePreferencesSchema),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const storeId = raw;
    const body = req.validatedBody as { preferences: Array<{ type: string; channel: string; enabled: boolean }> };
    const cp = getControlPlaneSupabase();

    // Verify the store exists.
    const { data: store, error: storeErr } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeErr || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Upsert each preference row (PK is store_id + type + channel).
    const rows = body.preferences.map((p) => ({
      store_id: storeId,
      type: p.type,
      channel: p.channel as "in_app" | "email",
      enabled: p.enabled,
    }));

    const { error: upsertErr } = await cp
      .from("notification_preferences")
      .upsert(rows, { onConflict: "store_id,type,channel" });

    if (upsertErr) {
      req.log?.error?.({ err: upsertErr }, "failed to upsert notification preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the preference update.
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "update_notification_preferences",
      entity: "notification_preferences",
      entityId: storeId,
      changes: { preferences: body.preferences, timestamp: new Date().toISOString() },
    });

    // Return the updated preferences.
    const { data: updated, error: fetchErr } = await cp
      .from("notification_preferences")
      .select("type, channel, enabled")
      .eq("store_id", storeId);

    if (fetchErr) {
      req.log?.error?.({ err: fetchErr }, "failed to fetch updated preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ data: updated ?? [] });
  },
);

export default router;
