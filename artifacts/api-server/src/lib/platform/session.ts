/**
 * Pure helpers for MFA enrollment verification and control-plane session validity.
 *
 * Feature: super-admin-platform
 * Requirements: 17.3, 17.4, 17.5, 17.7
 *
 * These functions contain no side effects, no DB calls, and no I/O —
 * they are designed to be fast-check property-testable (Property 28).
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum session lifetime: 8 hours from session start. */
export const SESSION_MAX_LIFETIME_MS = 8 * 60 * 60 * 1000; // 28_800_000

/** Session idle timeout: 15 minutes since last authenticated request. */
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 900_000

// ─── MFA Enrollment ─────────────────────────────────────────────────────────────

export interface MfaEnrollmentResult {
  /** Whether MFA is now enabled for the account. */
  mfaEnabled: boolean;
  /** Whether the MFA-enabled state changed as a result of this call. */
  changed: boolean;
}

/**
 * Determines the MFA enrollment outcome after a second-factor verification attempt.
 *
 * - If verification succeeded → mfaEnabled becomes true (R17.1).
 * - If verification failed → mfaEnabled is left unchanged (R17.2).
 *
 * @param verificationSucceeded - Whether the second-factor verification passed.
 * @param currentMfaEnabled - The account's current MFA-enabled state before this attempt.
 */
export function verifyMfaEnrollment(
  verificationSucceeded: boolean,
  currentMfaEnabled: boolean,
): MfaEnrollmentResult {
  if (verificationSucceeded) {
    return {
      mfaEnabled: true,
      changed: !currentMfaEnabled,
    };
  }
  // Verification failed — leave state unchanged (R17.2)
  return {
    mfaEnabled: currentMfaEnabled,
    changed: false,
  };
}

// ─── Session Validity ───────────────────────────────────────────────────────────

export interface ValidateSessionInput {
  /** When the session was created. */
  startedAt: Date;
  /** When the last authenticated request was made on this session. */
  lastSeenAt: Date;
  /** The current timestamp to evaluate against. */
  now: Date;
  /** Whether the user has presented a valid second factor for this session. */
  mfaVerified: boolean;
  /** Whether MFA is required for control-plane access. */
  mfaRequired: boolean;
}

export type SessionDenialReason = "lifetime_expiry" | "idle_timeout" | "mfa_required";

export interface SessionValidationResult {
  /** Whether the session is valid and access should be granted. */
  valid: boolean;
  /** If not valid, the reason access is denied. */
  reason?: SessionDenialReason;
}

/**
 * Validates a control-plane session against three conditions (R17.3–R17.7):
 *
 * 1. MFA: if mfaRequired, then mfaVerified must be true (R17.3, R17.4).
 * 2. Lifetime: now − startedAt < 8 hours (R17.5).
 * 3. Idle: now − lastSeenAt < 15 minutes (R17.5).
 *
 * Conditions are evaluated in priority order. The first failing condition
 * determines the denial reason.
 *
 * Server-side enforcement independent of client-side gating (R17.7).
 */
export function validateSession(input: ValidateSessionInput): SessionValidationResult {
  const { startedAt, lastSeenAt, now, mfaVerified, mfaRequired } = input;

  // Condition 1: MFA requirement (R17.3, R17.4)
  if (mfaRequired && !mfaVerified) {
    return { valid: false, reason: "mfa_required" };
  }

  // Condition 2: Lifetime check — session must not exceed 8 hours (R17.5)
  const lifetimeElapsed = now.getTime() - startedAt.getTime();
  if (lifetimeElapsed >= SESSION_MAX_LIFETIME_MS) {
    return { valid: false, reason: "lifetime_expiry" };
  }

  // Condition 3: Idle check — no more than 15 minutes since last activity (R17.5)
  const idleElapsed = now.getTime() - lastSeenAt.getTime();
  if (idleElapsed >= SESSION_IDLE_TIMEOUT_MS) {
    return { valid: false, reason: "idle_timeout" };
  }

  // All conditions pass — grant access
  return { valid: true };
}
