/**
 * Impersonation / support access routes.
 *
 * Feature: super-admin-platform
 * Requirements: 10.1, 10.2, 10.5, 10.6
 *
 * Routes:
 *  POST   /platform/impersonation      — start a read-only support session (≤2s)
 *  DELETE /platform/impersonation/:id   — end a session, revoke access (≤5s)
 *
 * All routes use requireSuperAdmin + getControlPlaneSupabase().
 * Session logic uses evaluateImpersonation / isSessionExpired from
 * lib/platform/impersonation.ts.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { validate } from "../../middlewares/validate";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { writePlatformAudit } from "../../lib/platform/audit";
import { IMPERSONATION_MAX_DURATION_MS, isSessionExpired } from "../../lib/platform/impersonation";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const StartImpersonationBody = z.object({
  store_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST /platform/impersonation — start an impersonation session (R10.1)
// ---------------------------------------------------------------------------
router.post(
  "/platform/impersonation",
  requireSuperAdmin,
  validate(StartImpersonationBody),
  async (req, res): Promise<void> => {
    const { store_id } = req.validatedBody as z.infer<typeof StartImpersonationBody>;
    const cp = getControlPlaneSupabase();
    const superAdminId = req.superAdmin!.userId;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IMPERSONATION_MAX_DURATION_MS);

    // Verify the target store exists
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id, platform_status")
      .eq("id", store_id)
      .single();

    if (storeError || !store) {
      // Audit the rejection (R10.2)
      writePlatformAudit({
        actorId: superAdminId,
        action: "impersonation_rejected",
        entity: "impersonation_session",
        storeId: store_id,
        changes: { reason: "store_not_found", timestamp: now.toISOString() },
      });
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Create the impersonation session
    const { data: session, error: insertError } = await cp
      .from("impersonation_sessions")
      .insert({
        super_admin_id: superAdminId,
        store_id,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select("id, super_admin_id, store_id, started_at, expires_at")
      .single();

    if (insertError || !session) {
      req.log?.error?.({ err: insertError }, "failed to create impersonation session");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit successful start (R10.1)
    writePlatformAudit({
      actorId: superAdminId,
      action: "impersonation_started",
      entity: "impersonation_session",
      entityId: session.id,
      storeId: store_id,
      changes: {
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
    });

    res.status(200).json({ data: session });
  },
);

// ---------------------------------------------------------------------------
// DELETE /platform/impersonation/:id — end a session (R10.6)
// ---------------------------------------------------------------------------
router.delete(
  "/platform/impersonation/:id",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();
    const superAdminId = req.superAdmin!.userId;
    const now = new Date();

    // Fetch the session
    const { data: session, error: fetchError } = await cp
      .from("impersonation_sessions")
      .select("id, super_admin_id, store_id, started_at, expires_at, ended_at, end_reason")
      .eq("id", sessionId)
      .single();

    if (fetchError || !session) {
      res.status(404).json({ error: "Impersonation session not found" });
      return;
    }

    // If already ended, return idempotent success
    if (session.ended_at != null) {
      res.status(200).json({ data: { id: session.id, ended_at: session.ended_at, end_reason: session.end_reason } });
      return;
    }

    // Determine end reason: expired if past expiry, otherwise manual
    const startedAt = new Date(session.started_at);
    const endReason = isSessionExpired(startedAt, now) ? "expired" : "manual";

    // End the session
    const { error: updateError } = await cp
      .from("impersonation_sessions")
      .update({ ended_at: now.toISOString(), end_reason: endReason })
      .eq("id", sessionId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "failed to end impersonation session");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit the end (R10.6)
    writePlatformAudit({
      actorId: superAdminId,
      action: "impersonation_ended",
      entity: "impersonation_session",
      entityId: sessionId,
      storeId: session.store_id,
      changes: {
        end_reason: endReason,
        ended_at: now.toISOString(),
      },
    });

    res.status(200).json({ data: { id: sessionId, ended_at: now.toISOString(), end_reason: endReason } });
  },
);

export default router;
