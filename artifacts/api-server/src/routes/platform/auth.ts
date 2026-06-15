/**
 * Platform auth/MFA/session routes.
 *
 * Feature: super-admin-platform
 * Requirements: 1.9, 17.1, 17.2, 17.6
 *
 * Endpoints:
 *   POST /platform/auth/mfa/enroll   — Begin TOTP enrollment (requireSuperAdmin)
 *   POST /platform/auth/mfa/verify   — Verify TOTP factor (requireSuperAdmin)
 *   POST /platform/auth/session      — Begin control-plane session (lighter auth)
 *   DELETE /platform/auth/session     — End current session (requireSuperAdmin)
 *
 * MFA uses Supabase Auth TOTP factors. Sign-in attempts and enrollment
 * outcomes are audited (R17.1, R17.2, R17.6).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import type { ControlPlaneDatabase } from "@workspace/supabase-types";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { validate } from "../../middlewares/validate";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { resolveControlPlaneEnv } from "../../lib/env";
import { writePlatformAudit } from "../../lib/platform/audit";

const { url: cpUrl } = resolveControlPlaneEnv(process.env);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a Supabase client scoped to the user's access token for MFA operations.
 */
function getAuthClient(accessToken: string) {
  const anonKey =
    process.env.CONTROL_PLANE_SUPABASE_ANON_KEY ??
    process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY ??
    "";
  return createClient<ControlPlaneDatabase>(cpUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Extract bearer token from Authorization header.
 */
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const MfaVerifySchema = z.object({
  factor_id: z.string().min(1, "factor_id is required"),
  code: z.string().min(1, "code is required"),
});

const SessionCreateSchema = z.object({
  factor_id: z.string().min(1, "factor_id is required"),
  code: z.string().min(1, "code is required"),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /platform/auth/mfa/enroll — Begin TOTP enrollment (R17.1, R17.6)
// ---------------------------------------------------------------------------
router.post(
  "/platform/auth/mfa/enroll",
  requireSuperAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const authClient = getAuthClient(token);
    const { data, error } = await authClient.auth.mfa.enroll({
      factorType: "totp",
    });

    if (error || !data) {
      writePlatformAudit({
        actorId: req.superAdmin!.userId,
        action: "mfa_enroll_failed",
        entity: "platform_admin",
        entityId: req.superAdmin!.userId,
        changes: { reason: error?.message ?? "unknown" },
      });
      req.log?.error?.({ err: error }, "MFA enrollment failed");
      res.status(400).json({ error: error?.message ?? "Enrollment failed" });
      return;
    }

    // Audit successful enrollment initiation (R17.6)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "mfa_enroll_started",
      entity: "platform_admin",
      entityId: req.superAdmin!.userId,
      changes: { factor_id: data.id },
    });

    res.json({
      data: {
        factor_id: data.id,
        totp: data.totp,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/auth/mfa/verify — Verify TOTP factor (R17.2, R17.6)
// ---------------------------------------------------------------------------
router.post(
  "/platform/auth/mfa/verify",
  requireSuperAdmin,
  validate(MfaVerifySchema),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.validatedBody as z.infer<typeof MfaVerifySchema>;
    const token = extractToken(req);
    if (!token) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const authClient = getAuthClient(token);

    // Challenge and verify in one step
    const { data, error } = await authClient.auth.mfa.challengeAndVerify({
      factorId: body.factor_id,
      code: body.code,
    });

    if (error || !data) {
      // Audit failed verification attempt (R17.2)
      writePlatformAudit({
        actorId: req.superAdmin!.userId,
        action: "mfa_verify_failed",
        entity: "platform_admin",
        entityId: req.superAdmin!.userId,
        changes: { factor_id: body.factor_id, reason: error?.message ?? "invalid_code" },
      });
      res.status(400).json({ error: error?.message ?? "Verification failed" });
      return;
    }

    // Update platform_admins.mfa_enabled = true
    const cp = getControlPlaneSupabase();
    const { error: updateError } = await cp
      .from("platform_admins")
      .update({ mfa_enabled: true })
      .eq("user_id", req.superAdmin!.userId);

    if (updateError) {
      req.log?.error?.({ err: updateError }, "failed to update mfa_enabled");
    }

    // Audit successful verification (R17.6)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "mfa_verify_success",
      entity: "platform_admin",
      entityId: req.superAdmin!.userId,
      changes: { factor_id: body.factor_id },
    });

    res.json({ data: { verified: true } });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/auth/session — Begin control-plane session (R17.1, R1.9)
//
// This route uses a LIGHTER auth check: verify user exists in platform_admins
// and verify MFA challenge, but does NOT require an existing active session
// (since the purpose of this route is to create a session).
// ---------------------------------------------------------------------------
router.post(
  "/platform/auth/session",
  validate(SessionCreateSchema),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.validatedBody as z.infer<typeof SessionCreateSchema>;
    const token = extractToken(req);

    if (!token) {
      writePlatformAudit({
        action: "session_create_failed",
        entity: "control_plane_session",
        changes: { reason: "missing_token", ip: req.ip ?? "unknown" },
      });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Verify user via Supabase Auth
    const authClient = getAuthClient(token);
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      writePlatformAudit({
        action: "session_create_failed",
        entity: "control_plane_session",
        changes: { reason: "invalid_token", ip: req.ip ?? "unknown" },
      });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userId = user.id;
    const cp = getControlPlaneSupabase();

    // Verify user is a platform_admin
    const { data: adminRow, error: adminError } = await cp
      .from("platform_admins")
      .select("user_id, mfa_enabled")
      .eq("user_id", userId)
      .single();

    if (adminError || !adminRow) {
      writePlatformAudit({
        actorId: userId,
        action: "session_create_failed",
        entity: "control_plane_session",
        changes: { reason: "not_platform_admin", ip: req.ip ?? "unknown" },
      });
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Verify MFA challenge
    const { data: mfaData, error: mfaError } =
      await authClient.auth.mfa.challengeAndVerify({
        factorId: body.factor_id,
        code: body.code,
      });

    if (mfaError || !mfaData) {
      writePlatformAudit({
        actorId: userId,
        action: "session_create_failed",
        entity: "control_plane_session",
        changes: {
          reason: "mfa_challenge_failed",
          factor_id: body.factor_id,
          ip: req.ip ?? "unknown",
        },
      });
      res.status(401).json({ error: "MFA verification failed" });
      return;
    }

    // End any existing active sessions for this user (enforce single-session)
    await cp
      .from("control_plane_sessions")
      .update({ ended_at: new Date().toISOString(), end_reason: "new_session" })
      .eq("user_id", userId)
      .is("ended_at", null);

    // Create a new session
    const now = new Date().toISOString();
    const { data: session, error: sessionError } = await cp
      .from("control_plane_sessions")
      .insert({
        user_id: userId,
        mfa_verified: true,
        started_at: now,
        last_seen_at: now,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      req.log?.error?.({ err: sessionError }, "session creation failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit successful sign-in (R17.1)
    writePlatformAudit({
      actorId: userId,
      action: "session_created",
      entity: "control_plane_session",
      entityId: session.id,
      changes: { ip: req.ip ?? "unknown", timestamp: now },
    });

    res.json({ data: { session_id: session.id } });
  },
);

// ---------------------------------------------------------------------------
// DELETE /platform/auth/session — End the current session (R17.1)
// ---------------------------------------------------------------------------
router.delete(
  "/platform/auth/session",
  requireSuperAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.superAdmin!.sessionId;
    const cp = getControlPlaneSupabase();

    const { error } = await cp
      .from("control_plane_sessions")
      .update({
        ended_at: new Date().toISOString(),
        end_reason: "signout",
      })
      .eq("id", sessionId);

    if (error) {
      req.log?.error?.({ err: error }, "session end failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Audit sign-out (R17.1)
    writePlatformAudit({
      actorId: req.superAdmin!.userId,
      action: "session_ended",
      entity: "control_plane_session",
      entityId: sessionId,
      changes: { reason: "signout", timestamp: new Date().toISOString() },
    });

    res.status(204).send();
  },
);

export default router;
