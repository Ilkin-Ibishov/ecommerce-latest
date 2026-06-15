/**
 * requireSuperAdmin middleware — guards interactive `/api/platform/*` routes.
 *
 * Steps:
 *  1. Extract bearer token from Authorization header
 *  2. Verify user via Supabase Auth (per-request client against the Control_Plane project)
 *  3. Query `platform_admins` to confirm super_admin tier
 *  4. Query `control_plane_sessions` for an active (non-ended) session
 *  5. Validate session with `validateSession()` (lifetime + idle + MFA)
 *  6. On success: attach `req.superAdmin`, update `last_seen_at`, call `next()`
 *  7. On failure: respond 403 + fire-and-forget denial audit entry
 *
 * Feature: super-admin-platform
 * Requirements: 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 17.5, 17.7
 */
import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import type { ControlPlaneDatabase } from "@workspace/supabase-types";
import { getControlPlaneSupabase } from "../lib/control-plane-supabase";
import { validateSession } from "../lib/platform/session";
import { resolveControlPlaneEnv } from "../lib/env";

const { url: cpUrl } = resolveControlPlaneEnv(process.env);

/**
 * Create a Supabase client scoped to the user's token for Auth verification.
 * Uses the Control_Plane project URL + the ANON key (needed for auth.getUser).
 */
function getControlPlaneAuthClient(accessToken: string) {
  const anonKey = process.env.CONTROL_PLANE_SUPABASE_ANON_KEY ?? process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY ?? "";
  return createClient<ControlPlaneDatabase>(cpUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Fire-and-forget denial audit entry into the Control_Plane audit_log.
 */
function writeDenialAudit(
  req: Request,
  reason: string,
  userId?: string,
): void {
  const cp = getControlPlaneSupabase();
  Promise.resolve(
    cp.from("audit_log").insert({
      actor_id: userId ?? null,
      action: "auth_denied",
      entity: "control_plane_session",
      entity_id: null,
      changes: { reason, ip: req.ip ?? "unknown" },
      scope: "platform",
      store_id: null,
    }),
  )
    .then(({ error }) => {
      if (error) {
        req.log?.error?.({ err: error }, "denial audit write failed");
      }
    })
    .catch((err: unknown) => {
      req.log?.error?.({ err }, "denial audit write failed");
    });
}

export async function requireSuperAdmin(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  // Step 1: Extract bearer token
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    writeDenialAudit(req, "missing_token");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Step 2: Verify user via Supabase Auth
  const authClient = getControlPlaneAuthClient(token);
  const { data: { user }, error: authError } = await authClient.auth.getUser();

  if (authError || !user) {
    writeDenialAudit(req, "invalid_token");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const userId = user.id;
  const cp = getControlPlaneSupabase();

  // Step 3: Verify user is a platform_admin with super_admin tier
  const { data: adminRow, error: adminError } = await cp
    .from("platform_admins")
    .select("user_id, mfa_enabled")
    .eq("user_id", userId)
    .single();

  if (adminError || !adminRow) {
    writeDenialAudit(req, "not_platform_admin", userId);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Step 4: Find an active (non-ended) session for this user
  const { data: sessionRow, error: sessionError } = await cp
    .from("control_plane_sessions")
    .select("id, user_id, mfa_verified, started_at, last_seen_at, ended_at")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (sessionError || !sessionRow) {
    writeDenialAudit(req, "no_active_session", userId);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Step 5: Validate session (MFA + lifetime + idle)
  const now = new Date();
  const validationResult = validateSession({
    startedAt: new Date(sessionRow.started_at),
    lastSeenAt: new Date(sessionRow.last_seen_at),
    now,
    mfaVerified: sessionRow.mfa_verified,
    mfaRequired: adminRow.mfa_enabled,
  });

  if (!validationResult.valid) {
    writeDenialAudit(req, `session_${validationResult.reason}`, userId);
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Step 6: Success — attach superAdmin, touch last_seen_at (fire-and-forget)
  req.superAdmin = { userId, sessionId: sessionRow.id };

  // Update last_seen_at to keep idle timer fresh (fire-and-forget)
  Promise.resolve(
    cp
      .from("control_plane_sessions")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", sessionRow.id),
  ).catch(() => {
    // Non-critical — log but don't block
  });

  _next();
}
