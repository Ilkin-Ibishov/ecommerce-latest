// Feature: super-admin-platform, Property 11: Platform_Status lifecycle transitions form a valid state machine

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  transitionPlatformStatus,
  createStoreDefaults,
  checkNameCollision,
  type PlatformStatus,
  type PlatformAction,
} from "../src/lib/platform/lifecycle";

/**
 * Property 11: Platform_Status lifecycle transitions form a valid state machine
 *
 * **Validates: Requirements 3.1, 3.2, 3.8, 3.9, 3.10, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2**
 */

// ─── Generators ─────────────────────────────────────────────────────────────────

const platformStatusArb: fc.Arbitrary<PlatformStatus> = fc.constantFrom(
  "onboarding",
  "active",
  "suspended",
  "disabled",
);

const platformActionArb: fc.Arbitrary<PlatformAction> = fc.constantFrom(
  "activate",
  "suspend",
  "reactivate",
  "disable",
);

/** The complete set of allowed transitions: (currentStatus, action) → expectedNewStatus */
const ALLOWED_TRANSITIONS: Array<{
  current: PlatformStatus;
  action: PlatformAction;
  expected: PlatformStatus;
}> = [
  { current: "onboarding", action: "activate", expected: "active" },
  { current: "active", action: "suspend", expected: "suspended" },
  { current: "suspended", action: "reactivate", expected: "active" },
  { current: "active", action: "disable", expected: "disabled" },
  { current: "suspended", action: "disable", expected: "disabled" },
];

/** Idempotent transitions: (status, action) → already_in_state */
const IDEMPOTENT_TRANSITIONS: Array<{
  current: PlatformStatus;
  action: PlatformAction;
}> = [
  { current: "suspended", action: "suspend" },
  { current: "active", action: "reactivate" },
  { current: "disabled", action: "disable" },
];

/** Build a lookup set for quick membership testing */
const allowedSet = new Set(
  ALLOWED_TRANSITIONS.map((t) => `${t.current}:${t.action}`),
);
const idempotentSet = new Set(
  IDEMPOTENT_TRANSITIONS.map((t) => `${t.current}:${t.action}`),
);

// ─── Arbitrary string generators for name collision ─────────────────────────────

const arbitraryNonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

// ─── Property Tests ─────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 11: Platform_Status lifecycle transitions form a valid state machine", () => {
  describe("1. Valid transitions produce expected states", () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 5.2, 5.4**
     *
     * For every allowed (status, action) pair, transitionPlatformStatus returns
     * { success: true, newStatus: <expected> }.
     */
    it("all allowed transitions produce correct newStatus", () => {
      const allowedTransitionArb = fc.constantFrom(...ALLOWED_TRANSITIONS);

      fc.assert(
        fc.property(allowedTransitionArb, ({ current, action, expected }) => {
          const result = transitionPlatformStatus(current, action);
          expect(result).toEqual({ success: true, newStatus: expected });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("2. Illegal transitions are rejected", () => {
    /**
     * **Validates: Requirements 5.3, 3.10**
     *
     * Any (status, action) pair NOT in the allowed set and NOT in the idempotent set
     * returns { success: false, reason: 'illegal_transition' }.
     */
    it("any pair not in allowed or idempotent set returns illegal_transition", () => {
      fc.assert(
        fc.property(platformStatusArb, platformActionArb, (status, action) => {
          const key = `${status}:${action}`;
          if (allowedSet.has(key) || idempotentSet.has(key)) {
            return; // skip — covered by other properties
          }
          const result = transitionPlatformStatus(status, action);
          expect(result).toEqual({
            success: false,
            reason: "illegal_transition",
          });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("3. Idempotent transitions", () => {
    /**
     * **Validates: Requirements 3.8, 3.9**
     *
     * suspend on suspended → already_in_state
     * reactivate on active → already_in_state
     * disable on disabled → already_in_state
     */
    it("idempotent transitions return already_in_state", () => {
      const idempotentArb = fc.constantFrom(...IDEMPOTENT_TRANSITIONS);

      fc.assert(
        fc.property(idempotentArb, ({ current, action }) => {
          const result = transitionPlatformStatus(current, action);
          expect(result).toEqual({
            success: false,
            reason: "already_in_state",
          });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("4. New store defaults", () => {
    /**
     * **Validates: Requirements 5.1, 6.1, 6.2**
     *
     * createStoreDefaults() always returns { platformStatus: 'onboarding', subscriptionStatus: 'trialing' }
     */
    it("createStoreDefaults always returns onboarding + trialing", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const defaults = createStoreDefaults();
          expect(defaults).toEqual({
            platformStatus: "onboarding",
            subscriptionStatus: "trialing",
          });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("5. Name collision is case-insensitive", () => {
    /**
     * **Validates: Requirements 5.6**
     *
     * For any string s and array including a case-variant of s,
     * checkNameCollision returns true; for strings NOT matching any element → false.
     */
    it("detects collision with case-variant present in array", () => {
      const caseTransformArb = fc.constantFrom(
        (s: string) => s.toUpperCase(),
        (s: string) => s.toLowerCase(),
        (s: string) =>
          s
            .split("")
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
            .join(""),
      );

      fc.assert(
        fc.property(
          arbitraryNonEmptyString,
          caseTransformArb,
          fc.array(arbitraryNonEmptyString, { minLength: 0, maxLength: 10 }),
          (name, transform, otherNames) => {
            const variant = transform(name);
            // Ensure the array contains at least the case-variant
            const existingNames = [...otherNames, variant];
            expect(checkNameCollision(name, existingNames)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("returns false when no element matches case-insensitively", () => {
      fc.assert(
        fc.property(
          arbitraryNonEmptyString,
          fc.array(arbitraryNonEmptyString, { minLength: 0, maxLength: 10 }),
          (name, existingNames) => {
            // Filter out any names that would match case-insensitively
            const filtered = existingNames.filter(
              (n) => n.toLowerCase() !== name.toLowerCase(),
            );
            expect(checkNameCollision(name, filtered)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
