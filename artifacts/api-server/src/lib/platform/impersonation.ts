/**
 * Pure decision logic for impersonation / support access sessions.
 *
 * An impersonation session grants a Super_Admin time-bounded, read-only access
 * to a single Store through that Store's authenticated endpoint — never through
 * direct database access. This module contains no side effects, no DB calls,
 * and no I/O — it is designed for property-based testing (Property 20).
 *
 * Feature: super-admin-platform
 * Requirements: 10.3, 10.4, 10.5, 10.7
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum impersonation session duration: 60 minutes from session start. */
export const IMPERSONATION_MAX_DURATION_MS = 60 * 60 * 1000; // 3_600_000

// ─── Types ──────────────────────────────────────────────────────────────────────

/** The type of operation being attempted within an impersonation session. */
export type OperationType = "read" | "write";

/** Reasons an impersonation access check may be denied. */
export type ImpersonationDenialReason =
  | "session_ended"
  | "session_expired"
  | "write_rejected"
  | "wrong_store";

/**
 * Describes the state of an impersonation session at the time of an access check.
 */
export interface ImpersonationSession {
  /** Unique identifier of the impersonation session. */
  sessionId: string;
  /** The Store this session grants access to. */
  targetStoreId: string;
  /** When the session was started (ISO timestamp or Date). */
  startedAt: Date;
  /** Whether the session has been explicitly ended by the Super_Admin. */
  ended: boolean;
}

/**
 * Describes a request being made within an impersonation session context.
 */
export interface ImpersonationAccessRequest {
  /** The Store the requester is trying to access. */
  requestedStoreId: string;
  /** The type of operation being attempted. */
  operationType: OperationType;
  /** The current time for expiry checks. */
  now: Date;
}

/**
 * The result of an impersonation access check.
 */
export interface ImpersonationAccessResult {
  /** Whether access is granted. */
  granted: boolean;
  /** HTTP status code to return on denial. */
  statusCode?: number;
  /** The reason for denial, if not granted. */
  reason?: ImpersonationDenialReason;
}

// ─── Simplified Evaluation Interface ─────────────────────────────────────────────

/**
 * Input for the simplified impersonation evaluation function.
 * Represents the pre-resolved state of a session at the time of an access check.
 */
export interface EvaluateImpersonationInput {
  /** Whether the session is currently active (not ended). */
  sessionActive: boolean;
  /** Whether the session has expired (>= 60 minutes from start). */
  expired: boolean;
  /** Whether the session has been explicitly ended. */
  ended: boolean;
  /** The Store this session was granted for. */
  targetStoreId: string;
  /** The Store being accessed in this request. */
  requestedStoreId: string;
  /** Whether the operation is a write (create/update/delete). */
  isWrite: boolean;
}

/**
 * Result of evaluateImpersonation when access is allowed.
 */
export interface ImpersonationAllowed {
  allowed: true;
}

/**
 * Result of evaluateImpersonation when access is denied.
 */
export interface ImpersonationDenied {
  allowed: false;
  httpStatus: 403;
  reason: string;
}

export type EvaluateImpersonationResult = ImpersonationAllowed | ImpersonationDenied;

/**
 * Evaluate whether an impersonation session permits the requested access.
 *
 * Pure function with a flat input object for straightforward property testing.
 *
 * Conditions evaluated in priority order:
 *  1. Session ended → rejected (R10.7)
 *  2. Session expired (≥60 min) → rejected (R10.5)
 *  3. Wrong store → rejected (R10.4)
 *  4. Write operation → rejected (R10.3)
 *
 * @returns `{ allowed: true }` or `{ allowed: false, httpStatus: 403, reason }`.
 */
export function evaluateImpersonation(input: EvaluateImpersonationInput): EvaluateImpersonationResult {
  const { sessionActive, expired, ended, targetStoreId, requestedStoreId, isWrite } = input;

  // R10.7: session that has been explicitly ended → reject
  if (ended || !sessionActive) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: "session_ended",
    };
  }

  // R10.5: session past 60-minute time bound → reject
  if (expired) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: "session_expired",
    };
  }

  // R10.4: access confined to the single target Store
  if (requestedStoreId !== targetStoreId) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: "wrong_store",
    };
  }

  // R10.3: write operations → 403, data unchanged
  if (isWrite) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: "write_rejected",
    };
  }

  // All conditions pass — grant read access to the target Store
  return { allowed: true };
}

// ─── Decision Functions ─────────────────────────────────────────────────────────

/**
 * Determines whether an impersonation session has expired based on its start time.
 *
 * A session expires 60 minutes after it was started (R10.5).
 */
export function isSessionExpired(startedAt: Date, now: Date): boolean {
  const elapsed = now.getTime() - startedAt.getTime();
  return elapsed >= IMPERSONATION_MAX_DURATION_MS;
}

/**
 * Evaluate whether an impersonation session permits the requested access.
 *
 * Access is granted iff ALL of:
 *  1. The session has not been explicitly ended (R10.7)
 *  2. The session has not expired (60 minutes from start) (R10.5, R10.7)
 *  3. The requested store matches the session's target store (R10.4)
 *  4. The operation type is "read" (writes are always rejected) (R10.3)
 *
 * Conditions are evaluated in priority order:
 *  - ended → rejected (session_ended)
 *  - expired → rejected (session_expired)
 *  - wrong store → rejected (wrong_store)
 *  - write operation → rejected (write_rejected, 403)
 *
 * @returns An access result indicating grant/deny with reason and status code.
 */
export function checkImpersonationAccess(
  session: ImpersonationSession,
  request: ImpersonationAccessRequest,
): ImpersonationAccessResult {
  // R10.7: session that has been explicitly ended → reject
  if (session.ended) {
    return {
      granted: false,
      statusCode: 403,
      reason: "session_ended",
    };
  }

  // R10.5: session past 60-minute time bound → reject
  if (isSessionExpired(session.startedAt, request.now)) {
    return {
      granted: false,
      statusCode: 403,
      reason: "session_expired",
    };
  }

  // R10.4: access confined to the single target Store
  if (request.requestedStoreId !== session.targetStoreId) {
    return {
      granted: false,
      statusCode: 403,
      reason: "wrong_store",
    };
  }

  // R10.3: write operations → 403, data unchanged
  if (request.operationType === "write") {
    return {
      granted: false,
      statusCode: 403,
      reason: "write_rejected",
    };
  }

  // All conditions pass — grant read access to the target Store
  return { granted: true };
}
