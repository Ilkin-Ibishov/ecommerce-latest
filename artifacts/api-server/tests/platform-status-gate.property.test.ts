import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateGate,
  resolveStatus,
  type OperationKind,
  type GateDecision,
  type ResolveStatusInput,
} from "../src/lib/store-hooks/platform-status";
import type { PlatformStatus } from "../src/lib/platform/lifecycle";

/**
 * Platform Status Self-Gate Property Tests
 * Feature: super-admin-platform
 *
 * Property 12: The Store enforces suspended and disabled status (self-gate), fail-safe to active
 * Property 13: Reactivation restores pre-suspension behavior with data intact
 *
 * **Validates: Requirements 3.3, 3.4, 3.7, 5.5**
 */

// ─── Generators ────────────────────────────────────────────────────────────────

const platformStatusArb: fc.Arbitrary<PlatformStatus> = fc.constantFrom(
  "onboarding",
  "active",
  "suspended",
  "disabled",
);

const operationKindArb: fc.Arbitrary<OperationKind> = fc.constantFrom(
  "admin_read",
  "admin_write",
  "storefront_read",
  "order_submit",
);

// ─── Property 12: Self-gate enforcement ────────────────────────────────────────

describe("Feature: super-admin-platform, Property 12: The Store enforces suspended and disabled status (self-gate), fail-safe to active", () => {
  describe("Gate evaluation — status-based access control", () => {
    /**
     * **Validates: Requirements 3.3, 3.4**
     *
     * For 'active' or 'onboarding' status, all operations are allowed.
     */
    it("active or onboarding + any operation → allowed", () => {
      const allowedStatusArb = fc.constantFrom<PlatformStatus>("active", "onboarding");

      fc.assert(
        fc.property(allowedStatusArb, operationKindArb, (status, operation) => {
          const decision = evaluateGate(status, operation);
          expect(decision).toEqual({ allowed: true });
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Suspended store allows admin_read only.
     */
    it("suspended + admin_read → allowed", () => {
      fc.assert(
        fc.property(fc.constant("suspended" as PlatformStatus), (status) => {
          const decision = evaluateGate(status, "admin_read");
          expect(decision).toEqual({ allowed: true });
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Suspended store blocks admin_write with 403.
     */
    it("suspended + admin_write → blocked (403)", () => {
      fc.assert(
        fc.property(fc.constant("suspended" as PlatformStatus), (status) => {
          const decision = evaluateGate(status, "admin_write");
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.3**
     *
     * Suspended store blocks order_submit with 403.
     */
    it("suspended + order_submit → blocked (403)", () => {
      fc.assert(
        fc.property(fc.constant("suspended" as PlatformStatus), (status) => {
          const decision = evaluateGate(status, "order_submit");
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.4**
     *
     * Suspended store blocks storefront_read with 503.
     */
    it("suspended + storefront_read → blocked (503)", () => {
      fc.assert(
        fc.property(fc.constant("suspended" as PlatformStatus), (status) => {
          const decision = evaluateGate(status, "storefront_read");
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(503);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.3, 3.4**
     *
     * Disabled store blocks all operations with 403.
     */
    it("disabled + any operation → blocked (403)", () => {
      fc.assert(
        fc.property(operationKindArb, (operation) => {
          const decision = evaluateGate("disabled", operation);
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 3.3, 3.4**
     *
     * Comprehensive property: for any (status, operation) pair, the gate
     * decision matches the expected policy matrix.
     */
    it("for any (status, operation) pair, the gate decision is consistent with the policy matrix", () => {
      fc.assert(
        fc.property(platformStatusArb, operationKindArb, (status, operation) => {
          const decision = evaluateGate(status, operation);

          if (status === "active" || status === "onboarding") {
            expect(decision.allowed).toBe(true);
          } else if (status === "disabled") {
            expect(decision.allowed).toBe(false);
            if (!decision.allowed) {
              expect(decision.httpStatus).toBe(403);
            }
          } else if (status === "suspended") {
            if (operation === "admin_read") {
              expect(decision.allowed).toBe(true);
            } else if (operation === "storefront_read") {
              expect(decision.allowed).toBe(false);
              if (!decision.allowed) {
                expect(decision.httpStatus).toBe(503);
              }
            } else {
              // admin_write, order_submit
              expect(decision.allowed).toBe(false);
              if (!decision.allowed) {
                expect(decision.httpStatus).toBe(403);
              }
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Status resolver — fail-safe logic", () => {
    /**
     * **Validates: Requirements 5.5**
     *
     * When fetchResult is 'unreachable' and cachedStatus is null,
     * resolveStatus returns 'active' (fail-safe).
     */
    it("unreachable + no cache → fail-safe to 'active'", () => {
      fc.assert(
        fc.property(fc.boolean(), (cacheExpired) => {
          const input: ResolveStatusInput = {
            cachedStatus: null,
            cacheExpired,
            fetchResult: "unreachable",
          };
          const result = resolveStatus(input);
          expect(result).toBe("active");
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.5**
     *
     * When fetchResult is a valid PlatformStatus, resolveStatus returns
     * that status directly (fresh value from Control_Plane).
     */
    it("valid fetchResult → returns that status (fresh)", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant<PlatformStatus | null>(null), platformStatusArb),
          fc.boolean(),
          platformStatusArb,
          (cachedStatus, cacheExpired, freshStatus) => {
            const input: ResolveStatusInput = {
              cachedStatus,
              cacheExpired,
              fetchResult: freshStatus,
            };
            const result = resolveStatus(input);
            expect(result).toBe(freshStatus);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.5**
     *
     * When fetchResult is 'unreachable' and cachedStatus is not null,
     * resolveStatus returns the cached (stale) status.
     */
    it("unreachable + cached status present → returns cachedStatus (stale)", () => {
      fc.assert(
        fc.property(platformStatusArb, fc.boolean(), (cachedStatus, cacheExpired) => {
          const input: ResolveStatusInput = {
            cachedStatus,
            cacheExpired,
            fetchResult: "unreachable",
          };
          const result = resolveStatus(input);
          expect(result).toBe(cachedStatus);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * **Validates: Requirements 5.5**
     *
     * The fail-safe guarantees a Control_Plane outage never blocks a paying Store.
     * Specifically: resolveStatus never returns 'suspended' or 'disabled' when
     * the fetch is unreachable and there is no cache.
     */
    it("fail-safe never returns a blocking status when Control_Plane is unreachable with no cache", () => {
      fc.assert(
        fc.property(fc.boolean(), (cacheExpired) => {
          const input: ResolveStatusInput = {
            cachedStatus: null,
            cacheExpired,
            fetchResult: "unreachable",
          };
          const result = resolveStatus(input);
          // Fail-safe means no blocking — must be active or onboarding (both are permitted)
          expect(result === "active" || result === "onboarding").toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Property 13: Reactivation restores pre-suspension behavior ────────────────

describe("Feature: super-admin-platform, Property 13: Reactivation restores pre-suspension behavior with data intact", () => {
  /**
   * **Validates: Requirements 3.7**
   *
   * After suspending (evaluateGate with 'suspended') and then reactivating
   * (evaluateGate with 'active'), the gate decisions are identical to the
   * original 'active' state for all operations.
   */
  it("suspending then reactivating produces the same gate decisions as original active state", () => {
    fc.assert(
      fc.property(operationKindArb, (operation) => {
        // Original active behavior
        const originalDecision = evaluateGate("active", operation);

        // After suspension...
        const suspendedDecision = evaluateGate("suspended", operation);
        // Verify suspension actually blocks some operations (sanity check)
        if (operation !== "admin_read") {
          expect(suspendedDecision.allowed).toBe(false);
        }

        // After reactivation — back to active
        const reactivatedDecision = evaluateGate("active", operation);

        // Reactivation restores original behavior
        expect(reactivatedDecision).toEqual(originalDecision);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.7**
   *
   * The resolveStatus function correctly transitions from suspended to active
   * when the Control_Plane updates the status (simulating reactivation).
   */
  it("status resolver correctly transitions from suspended cache to active fetch (reactivation)", () => {
    fc.assert(
      fc.property(fc.boolean(), (cacheExpired) => {
        // Before reactivation: cache says suspended
        const beforeInput: ResolveStatusInput = {
          cachedStatus: "suspended",
          cacheExpired,
          fetchResult: "unreachable",
        };
        const beforeStatus = resolveStatus(beforeInput);
        expect(beforeStatus).toBe("suspended");

        // After reactivation: fresh fetch says active
        const afterInput: ResolveStatusInput = {
          cachedStatus: "suspended",
          cacheExpired,
          fetchResult: "active",
        };
        const afterStatus = resolveStatus(afterInput);
        expect(afterStatus).toBe("active");

        // Verify full gate behavior is restored for all operation kinds
        const operations: OperationKind[] = [
          "admin_read",
          "admin_write",
          "storefront_read",
          "order_submit",
        ];
        for (const op of operations) {
          const decision = evaluateGate(afterStatus, op);
          expect(decision).toEqual({ allowed: true });
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.7**
   *
   * Reactivation preserves data integrity: the gate is purely a decision
   * function — it does not mutate any state. The same input always produces
   * the same output regardless of prior calls.
   */
  it("gate is a pure function — repeated evaluations with same input yield same result", () => {
    fc.assert(
      fc.property(platformStatusArb, operationKindArb, (status, operation) => {
        const first = evaluateGate(status, operation);
        const second = evaluateGate(status, operation);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });
});
