/**
 * Offboarding routes — initiate, export, restore, purge.
 *
 * Feature: super-admin-platform
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9
 *
 * Routes:
 *  POST /platform/stores/:id/offboard  — start 30-day retention (R16.1)
 *  GET  /platform/stores/:id/export    — download CP records ≤60s (R16.2, R16.9)
 *  POST /platform/stores/:id/restore   — restore before retention ends (R16.3, R16.5)
 *  POST /platform/stores/:id/purge     — destructive purge with typed confirmation (R16.6, R16.7)
 *
 * All routes use requireSuperAdmin + getControlPlaneSupabase().
 * All actions are audited.
 */
import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { writePlatformAudit } from "../../lib/platform/audit";
import {
  canInitiateOffboarding,
  canRestore,
  canExport,
  canPurge,
  computeRetentionEnd,
} from "../../lib/platform/offboarding";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/offboard — initiate offboarding (R16.1)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/offboard",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const now = new Date();

    // Verify store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id, platform_status, per_store_credential_hash")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Check if offboarding can be initiated based on platform_status
    if (!canInitiateOffboarding(store.platform_status)) {
      res.status(409).json({ error: `Cannot offboard a store in '${store.platform_status}' status` });
      return;
    }

    // Check for existing offboarding record
    const { data: existing } = await cp
      .from("store_offboarding")
      .select("store_id, purged, retention_ends_at")
      .eq("store_id", storeId)
      .single();

    if (existing) {
      if (existing.purged) {
        res.status(409).json({ error: "Store has already been purged" });
        return;
      }
      // Already in retention — idempotent; check if not yet expired
      const retentionEnd = new Date(existing.retention_ends_at);
      if (now < retentionEnd) {
        res.status(409).json({ error: "Store is already in offboarding retention" });
        return;
      }
      // Retention expired but not purged — treat as re-initiation blocked
      res.status(409).json({ error: "Store retention has expired; purge is pending" });
      return;
    }

    const retentionEndsAt = computeRetentionEnd(now);

    // Insert offboarding record
    const { error: insertError } = await cp
      .from("store_offboarding")
      .insert({
        store_id: storeId,
        initiated_at: now.toISOString(),
        retention_ends_at: retentionEndsAt.toISOString(),
        status_before: store.platform_status,
      });

    if (insertError) {
      req.log?.error?.({ err: insertError }, "failed to insert offboarding record");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Set platform_status to disabled
    const { error: updateError } = await cp
      .from("stores")
      .update({ platform_status: "disabled" })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "failed to update store status on offboard");
    }

    // Rotate the per_store_credential_hash on offboard (invalidate access)
    const { error: credError } = await cp
      .from("stores")
      .update({ per_store_credential_hash: `revoked_${Date.now()}` })
      .eq("id", storeId);

    if (credError) {
      req.log?.error?.({ err: credError }, "failed to rotate credential hash on offboard");
    }

    // Audit the action
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "offboard_initiated",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        status_before: store.platform_status,
        retention_ends_at: retentionEndsAt.toISOString(),
        timestamp: now.toISOString(),
      },
    });

    res.json({
      data: {
        store_id: storeId,
        initiated_at: now.toISOString(),
        retention_ends_at: retentionEndsAt.toISOString(),
        status_before: store.platform_status,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/stores/:id/export — export CP records (R16.2, R16.9)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores/:id/export",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const now = new Date();

    // Verify store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch offboarding record
    const { data: offboarding, error: offError } = await cp
      .from("store_offboarding")
      .select("store_id, purged, retention_ends_at")
      .eq("store_id", storeId)
      .single();

    if (offError || !offboarding) {
      res.status(404).json({ error: "No offboarding record found for this store" });
      return;
    }

    // Check export eligibility
    const retentionEnded = now >= new Date(offboarding.retention_ends_at);
    const exportCheck = canExport({ purged: offboarding.purged, retentionEnded });

    if (!exportCheck.success) {
      res.status(409).json({ error: exportCheck.error });
      return;
    }

    // Gather all Control_Plane records for this store
    const [invoicesResult, notificationsResult, metricsResult, auditResult] = await Promise.all([
      cp.from("invoices").select("*").eq("store_id", storeId),
      cp.from("platform_notification_targets").select("notification_id").eq("store_id", storeId),
      cp.from("store_metrics_cache").select("*").eq("store_id", storeId),
      cp.from("audit_log").select("*").eq("store_id", storeId).order("created_at", { ascending: false }),
    ]);

    // Audit the export
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "offboard_export",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        timestamp: now.toISOString(),
      },
    });

    res.json({
      data: {
        store_id: storeId,
        exported_at: now.toISOString(),
        records: {
          invoices: invoicesResult.data ?? [],
          notification_targets: notificationsResult.data ?? [],
          metrics_cache: metricsResult.data ?? [],
          audit_log: auditResult.data ?? [],
        },
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/restore — restore before retention ends (R16.3, R16.5)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/restore",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const now = new Date();

    // Verify store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch offboarding record
    const { data: offboarding, error: offError } = await cp
      .from("store_offboarding")
      .select("store_id, purged, retention_ends_at, status_before")
      .eq("store_id", storeId)
      .single();

    if (offError || !offboarding) {
      res.status(404).json({ error: "No offboarding record found for this store" });
      return;
    }

    // Check restore eligibility
    const retentionEnded = now >= new Date(offboarding.retention_ends_at);
    const restoreCheck = canRestore({ purged: offboarding.purged, retentionEnded });

    if (!restoreCheck.success) {
      res.status(409).json({ error: restoreCheck.error });
      return;
    }

    // Restore: set platform_status back to status_before, remove offboarding record
    const restoredStatus = offboarding.status_before as "onboarding" | "active" | "suspended" | "disabled";

    const { error: updateError } = await cp
      .from("stores")
      .update({ platform_status: restoredStatus })
      .eq("id", storeId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "failed to restore store status");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Mark offboarding record as restored
    const { error: restoreError } = await cp
      .from("store_offboarding")
      .update({ restored_at: now.toISOString() })
      .eq("store_id", storeId);

    if (restoreError) {
      req.log?.error?.({ err: restoreError }, "failed to mark offboarding as restored");
    }

    // Delete offboarding record (the store is active again)
    await cp.from("store_offboarding").delete().eq("store_id", storeId);

    // Audit the restore
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "offboard_restore",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        restored_status: restoredStatus,
        timestamp: now.toISOString(),
      },
    });

    res.json({
      data: {
        store_id: storeId,
        restored_status: restoredStatus,
        restored_at: now.toISOString(),
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/stores/:id/purge — destructive purge with confirmation (R16.6, R16.7)
// ---------------------------------------------------------------------------
router.post(
  "/platform/stores/:id/purge",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const now = new Date();

    // Verify store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id, name")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch offboarding record
    const { data: offboarding, error: offError } = await cp
      .from("store_offboarding")
      .select("store_id, purged")
      .eq("store_id", storeId)
      .single();

    if (offError || !offboarding) {
      res.status(404).json({ error: "No offboarding record found for this store" });
      return;
    }

    if (offboarding.purged) {
      res.status(409).json({ error: "Store has already been purged" });
      return;
    }

    // Check purge confirmation — must match the store_id (R16.6)
    const confirmation = req.body?.confirmation;
    if (confirmation == null) {
      res.status(400).json({ error: "Missing 'confirmation' field — must match the target store id" });
      return;
    }

    const purgeCheck = canPurge({
      confirmation: String(confirmation),
      expectedConfirmation: storeId,
    });

    if (!purgeCheck.success) {
      res.status(400).json({ error: purgeCheck.error });
      return;
    }

    // Execute purge — delete Control_Plane records for this store
    // Order matters: children first to avoid FK violations
    await cp.from("platform_notification_reads").delete().eq("store_id", storeId);
    await cp.from("platform_notification_targets").delete().eq("store_id", storeId);
    await cp.from("grace_periods").delete().eq("store_id", storeId);
    await cp.from("invoices").delete().eq("store_id", storeId);
    await cp.from("store_metrics_cache").delete().eq("store_id", storeId);

    // Mark offboarding record as purged (R16.7 — record teardown as distinct step)
    const { error: purgeError } = await cp
      .from("store_offboarding")
      .update({
        purged: true,
        purged_at: now.toISOString(),
        teardown_recorded: true,
        teardown_at: now.toISOString(),
      })
      .eq("store_id", storeId);

    if (purgeError) {
      req.log?.error?.({ err: purgeError }, "failed to mark offboarding as purged");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the purge action
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "offboard_purge",
      entity: "store",
      entityId: storeId,
      storeId,
      changes: {
        purged_at: now.toISOString(),
        teardown_recorded: true,
        timestamp: now.toISOString(),
      },
    });

    res.json({
      data: {
        store_id: storeId,
        purged: true,
        purged_at: now.toISOString(),
        teardown_recorded: true,
      },
    });
  },
);

export default router;
