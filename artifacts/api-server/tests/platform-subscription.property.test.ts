import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 16: Subscription-status update is atomic and round-trips

import {
  validateSubscriptionStatusUpdate,
  VALID_SUBSCRIPTION_STATUSES,
  type SubscriptionStatusValue,
} from "../src/lib/platform/subscription";

// ─── Generators ────────────────────────────────────────────────────────────────

const validStatusArb: fc.Arbitrary<SubscriptionStatusValue> = fc.constantFrom(
  "trialing",
  "active",
  "past_due",
  "cancelled",
);

const invalidStatusArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(VALID_SUBSCRIPTION_STATUSES as readonly string[]).includes(s));

// ─── Property 16: Subscription-status update is atomic and round-trips ──────────

describe("Feature: super-admin-platform, Property 16: Subscription-status update is atomic and round-trips", () => {
  describe("value in set → valid", () => {
    it("any status in VALID_SUBSCRIPTION_STATUSES with storeExists=true → valid result with same value", () => {
      fc.assert(
        fc.property(validStatusArb, (status) => {
          const result = validateSubscriptionStatusUpdate({
            newStatus: status,
            storeExists: true,
          });

          expect(result).toHaveProperty("valid", true);
          if (result.valid) {
            expect(result.newStatus).toBe(status);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("round-trip: the newStatus returned is exactly the input value (no mutation)", () => {
      fc.assert(
        fc.property(validStatusArb, (status) => {
          const result = validateSubscriptionStatusUpdate({
            newStatus: status,
            storeExists: true,
          });

          if (result.valid) {
            // The returned value must be identical to the input
            expect(result.newStatus).toStrictEqual(status);
            // And it must be one of the valid enum values
            expect(VALID_SUBSCRIPTION_STATUSES).toContain(result.newStatus);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("value out of set → 400", () => {
    it("any string NOT in VALID_SUBSCRIPTION_STATUSES → httpStatus 400", () => {
      fc.assert(
        fc.property(invalidStatusArb, (status) => {
          const result = validateSubscriptionStatusUpdate({
            newStatus: status,
            storeExists: true,
          });

          expect(result).toHaveProperty("valid", false);
          if (!result.valid) {
            expect(result.httpStatus).toBe(400);
            expect(result.error).toContain("Subscription status must be one of");
          }
        }),
        { numRuns: 100 },
      );
    });

    it("empty string → 400", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "",
        storeExists: true,
      });
      expect(result).toHaveProperty("valid", false);
      if (!result.valid) {
        expect(result.httpStatus).toBe(400);
      }
    });
  });

  describe("storeExists false → 400", () => {
    it("any status (valid or invalid) with storeExists=false → httpStatus 400", () => {
      fc.assert(
        fc.property(
          fc.oneof(validStatusArb, invalidStatusArb),
          (status) => {
            const result = validateSubscriptionStatusUpdate({
              newStatus: status,
              storeExists: false,
            });

            expect(result).toHaveProperty("valid", false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
              expect(result.error).toContain("Store identifier is missing or invalid");
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("atomicity invariant", () => {
    it("invalid input never produces a valid result (status unchanged guarantee)", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Case 1: invalid status, store exists
            fc.tuple(invalidStatusArb, fc.constant(true)),
            // Case 2: any status, store doesn't exist
            fc.tuple(fc.string({ minLength: 0, maxLength: 30 }), fc.constant(false)),
          ),
          ([status, storeExists]) => {
            const result = validateSubscriptionStatusUpdate({
              newStatus: status,
              storeExists,
            });
            // Must always be invalid — status is never persisted
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
