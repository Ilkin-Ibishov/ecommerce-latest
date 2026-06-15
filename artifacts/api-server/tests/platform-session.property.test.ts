import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 28: MFA enrollment and control-plane session validity

/**
 * Property 28: MFA enrollment and control-plane session validity.
 *
 * **Validates: Requirements 17.3, 17.4, 17.5, 17.7**
 *
 * Properties:
 * 1. verifyMfaEnrollment: successful verification always results in mfaEnabled=true;
 *    failed verification always leaves mfaEnabled at its prior value (unchanged).
 * 2. validateSession: access is granted iff (mfaRequired implies mfaVerified)
 *    AND (now - startedAt < 8h) AND (now - lastSeenAt < 15m).
 *    Boundary conditions via arbitrary generation of time differences.
 */

import {
  verifyMfaEnrollment,
  validateSession,
  SESSION_MAX_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "../src/lib/platform/session";

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate constrained dates where startedAt <= lastSeenAt <= now */
const sessionDatesArb = fc
  .tuple(
    fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
    fc.nat({ max: 24 * 60 * 60 * 1000 }), // offset from startedAt to lastSeenAt (up to 24h)
    fc.nat({ max: 24 * 60 * 60 * 1000 }), // offset from lastSeenAt to now (up to 24h)
  )
  .map(([startedAt, offsetToLastSeen, offsetToNow]) => {
    const lastSeenAt = new Date(startedAt.getTime() + offsetToLastSeen);
    const now = new Date(lastSeenAt.getTime() + offsetToNow);
    return { startedAt, lastSeenAt, now };
  });

// ─── Property 28.1: MFA Enrollment ─────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 28: MFA enrollment and control-plane session validity", () => {
  describe("verifyMfaEnrollment", () => {
    /**
     * **Validates: Requirements 17.3, 17.4**
     *
     * Successful verification always results in mfaEnabled=true regardless of prior state.
     */
    it("successful verification always results in mfaEnabled=true", () => {
      fc.assert(
        fc.property(fc.boolean(), (currentMfaEnabled) => {
          const result = verifyMfaEnrollment(true, currentMfaEnabled);
          expect(result.mfaEnabled).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.3, 17.4**
     *
     * Failed verification always leaves mfaEnabled at its prior value (unchanged).
     */
    it("failed verification leaves mfaEnabled unchanged at its prior value", () => {
      fc.assert(
        fc.property(fc.boolean(), (currentMfaEnabled) => {
          const result = verifyMfaEnrollment(false, currentMfaEnabled);
          expect(result.mfaEnabled).toBe(currentMfaEnabled);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.3, 17.4**
     *
     * For any combination of verificationSucceeded and currentMfaEnabled,
     * the result matches the specified enrollment logic.
     */
    it("enrollment outcome matches the specification for all input combinations", () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (verificationSucceeded, currentMfaEnabled) => {
          const result = verifyMfaEnrollment(verificationSucceeded, currentMfaEnabled);

          if (verificationSucceeded) {
            // Success → mfaEnabled must be true
            expect(result.mfaEnabled).toBe(true);
            // changed iff it was not already enabled
            expect(result.changed).toBe(!currentMfaEnabled);
          } else {
            // Failure → mfaEnabled unchanged
            expect(result.mfaEnabled).toBe(currentMfaEnabled);
            // changed is always false on failure
            expect(result.changed).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ─── Property 28.2: Session Validity ────────────────────────────────────────

  describe("validateSession", () => {
    /**
     * **Validates: Requirements 17.3, 17.4, 17.5, 17.7**
     *
     * Access is granted iff:
     *   (mfaRequired implies mfaVerified) AND
     *   (now - startedAt < 8h) AND
     *   (now - lastSeenAt < 15m)
     */
    it("access is granted iff MFA satisfied AND within lifetime AND within idle timeout", () => {
      fc.assert(
        fc.property(
          sessionDatesArb,
          fc.boolean(),
          fc.boolean(),
          ({ startedAt, lastSeenAt, now }, mfaVerified, mfaRequired) => {
            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified,
              mfaRequired,
            });

            const lifetimeElapsed = now.getTime() - startedAt.getTime();
            const idleElapsed = now.getTime() - lastSeenAt.getTime();

            const mfaSatisfied = !mfaRequired || mfaVerified;
            const withinLifetime = lifetimeElapsed < SESSION_MAX_LIFETIME_MS;
            const withinIdle = idleElapsed < SESSION_IDLE_TIMEOUT_MS;

            const expectedValid = mfaSatisfied && withinLifetime && withinIdle;

            expect(result.valid).toBe(expectedValid);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * When lifetime is exceeded (now - startedAt >= 8h) and MFA is satisfied,
     * the session is denied with reason "lifetime_expiry".
     */
    it("sessions exceeding 8h lifetime are denied with lifetime_expiry reason", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          fc.integer({ min: SESSION_MAX_LIFETIME_MS, max: SESSION_MAX_LIFETIME_MS + 24 * 60 * 60 * 1000 }),
          fc.nat({ max: SESSION_IDLE_TIMEOUT_MS - 1 }), // idle within bounds so lifetime is the trigger
          (startedAt, lifetimeMs, idleMs) => {
            const now = new Date(startedAt.getTime() + lifetimeMs);
            const lastSeenAt = new Date(now.getTime() - idleMs);

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("lifetime_expiry");
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * When idle timeout is exceeded (now - lastSeenAt >= 15m) but lifetime is OK
     * and MFA is satisfied, the session is denied with reason "idle_timeout".
     */
    it("sessions exceeding 15m idle are denied with idle_timeout reason", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          fc.integer({ min: SESSION_IDLE_TIMEOUT_MS, max: SESSION_MAX_LIFETIME_MS - 1 }), // idle exceeds, lifetime under
          (startedAt, idleMs) => {
            // Ensure the total lifetime is less than 8h but idle exceeds 15m
            const lastSeenAt = new Date(startedAt.getTime() + 1000); // lastSeen just after start
            const now = new Date(lastSeenAt.getTime() + idleMs);

            // Double-check our constraint: lifetime must be under 8h
            const totalLifetime = now.getTime() - startedAt.getTime();
            fc.pre(totalLifetime < SESSION_MAX_LIFETIME_MS);

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("idle_timeout");
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.3, 17.4, 17.7**
     *
     * When MFA is required but not verified, session is denied with reason "mfa_required",
     * regardless of time constraints.
     */
    it("sessions without MFA when required are denied with mfa_required reason", () => {
      fc.assert(
        fc.property(
          sessionDatesArb,
          ({ startedAt, lastSeenAt, now }) => {
            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: false,
              mfaRequired: true,
            });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("mfa_required");
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.3, 17.4, 17.7**
     *
     * When MFA is not required, the mfaVerified flag does not affect session validity.
     * Access depends only on lifetime and idle constraints.
     */
    it("when MFA is not required, mfaVerified does not affect validity", () => {
      fc.assert(
        fc.property(
          sessionDatesArb,
          fc.boolean(),
          ({ startedAt, lastSeenAt, now }, mfaVerified) => {
            const resultWithMfa = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified,
              mfaRequired: false,
            });
            const resultWithoutMfa = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: !mfaVerified,
              mfaRequired: false,
            });

            expect(resultWithMfa.valid).toBe(resultWithoutMfa.valid);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * Boundary: a session at exactly 8h lifetime is denied (>= check).
     */
    it("session at exactly 8h boundary is denied", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          (startedAt) => {
            const now = new Date(startedAt.getTime() + SESSION_MAX_LIFETIME_MS);
            const lastSeenAt = now; // no idle issue

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("lifetime_expiry");
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * Boundary: a session at exactly 15m idle is denied (>= check).
     */
    it("session at exactly 15m idle boundary is denied", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          (startedAt) => {
            const lastSeenAt = new Date(startedAt.getTime() + 1000);
            const now = new Date(lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_MS);

            // Ensure lifetime is within bounds
            fc.pre(now.getTime() - startedAt.getTime() < SESSION_MAX_LIFETIME_MS);

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(false);
            expect(result.reason).toBe("idle_timeout");
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * Boundary: 1ms before 8h lifetime is valid (when idle and MFA are OK).
     */
    it("session 1ms before 8h boundary is valid when idle and MFA are satisfied", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          (startedAt) => {
            const now = new Date(startedAt.getTime() + SESSION_MAX_LIFETIME_MS - 1);
            const lastSeenAt = now; // no idle issue

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 17.5, 17.7**
     *
     * Boundary: 1ms before 15m idle is valid (when lifetime and MFA are OK).
     */
    it("session 1ms before 15m idle boundary is valid when lifetime and MFA are satisfied", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }),
          (startedAt) => {
            const lastSeenAt = new Date(startedAt.getTime() + 1000);
            const now = new Date(lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_MS - 1);

            // Ensure lifetime is within bounds
            fc.pre(now.getTime() - startedAt.getTime() < SESSION_MAX_LIFETIME_MS);

            const result = validateSession({
              startedAt,
              lastSeenAt,
              now,
              mfaVerified: true,
              mfaRequired: true,
            });

            expect(result.valid).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
