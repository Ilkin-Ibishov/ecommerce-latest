import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 24: Automated billing lifecycle transitions are correct

import { applyBillingEvent, type BillingState, type BillingEvent } from "../src/lib/billing/transition";

// ─── Generators ────────────────────────────────────────────────────────────────

const subscriptionStatusArb = fc.constantFrom("trialing" as const, "active" as const, "past_due" as const, "cancelled" as const);
const platformStatusArb = fc.constantFrom("onboarding" as const, "active" as const, "suspended" as const, "disabled" as const);

const billingStateArb: fc.Arbitrary<BillingState> = fc.record({
  subscriptionStatus: subscriptionStatusArb,
  platformStatus: platformStatusArb,
  gracePeriodActive: fc.boolean(),
});

const invoiceIdArb = fc.uuid();

// ─── Property 24: Automated billing lifecycle transitions ───────────────────────

describe("Feature: super-admin-platform, Property 24: Automated billing lifecycle transitions are correct", () => {
  describe("invoice_due_passed → past_due (paid→active never becomes past_due wrongly)", () => {
    it("active or trialing subscription + invoice_due_passed → subscription becomes past_due", () => {
      fc.assert(
        fc.property(
          billingStateArb.filter((s) => s.subscriptionStatus === "active" || s.subscriptionStatus === "trialing"),
          invoiceIdArb,
          (state, invoiceId) => {
            const event: BillingEvent = { type: "invoice_due_passed", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).not.toBeNull();
            if (result) {
              expect(result.newSubscriptionStatus).toBe("past_due");
              // Platform status unchanged
              expect(result.newPlatformStatus).toBe(state.platformStatus);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("already past_due or cancelled → no transition (idempotent)", () => {
      fc.assert(
        fc.property(
          billingStateArb.filter((s) => s.subscriptionStatus === "past_due" || s.subscriptionStatus === "cancelled"),
          invoiceIdArb,
          (state, invoiceId) => {
            const event: BillingEvent = { type: "invoice_due_passed", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("unpaid → grace_period_ended → suspended", () => {
    it("past_due subscription + active platform + grace_period_ended → platform suspended", () => {
      fc.assert(
        fc.property(invoiceIdArb, fc.boolean(), (invoiceId, gracePeriodActive) => {
          const state: BillingState = {
            subscriptionStatus: "past_due",
            platformStatus: "active",
            gracePeriodActive,
          };
          const event: BillingEvent = { type: "grace_period_ended", invoiceId };
          const result = applyBillingEvent(state, event);
          expect(result).not.toBeNull();
          if (result) {
            expect(result.newPlatformStatus).toBe("suspended");
            expect(result.newSubscriptionStatus).toBe("past_due");
            expect(result.endGracePeriod).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("non-past_due subscription + grace_period_ended → no transition (payment came in during grace)", () => {
      fc.assert(
        fc.property(
          billingStateArb.filter((s) => s.subscriptionStatus !== "past_due"),
          invoiceIdArb,
          (state, invoiceId) => {
            const event: BillingEvent = { type: "grace_period_ended", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("payment after suspension → active", () => {
    it("past_due + suspended + payment_recorded → both subscription and platform become active", () => {
      fc.assert(
        fc.property(invoiceIdArb, fc.boolean(), (invoiceId, gracePeriodActive) => {
          const state: BillingState = {
            subscriptionStatus: "past_due",
            platformStatus: "suspended",
            gracePeriodActive,
          };
          const event: BillingEvent = { type: "payment_recorded", invoiceId };
          const result = applyBillingEvent(state, event);
          expect(result).not.toBeNull();
          if (result) {
            expect(result.newSubscriptionStatus).toBe("active");
            expect(result.newPlatformStatus).toBe("active");
            expect(result.endGracePeriod).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("past_due + non-suspended platform + payment_recorded → subscription active, platform unchanged", () => {
      fc.assert(
        fc.property(
          platformStatusArb.filter((s) => s !== "suspended"),
          invoiceIdArb,
          fc.boolean(),
          (platformStatus, invoiceId, gracePeriodActive) => {
            const state: BillingState = {
              subscriptionStatus: "past_due",
              platformStatus,
              gracePeriodActive,
            };
            const event: BillingEvent = { type: "payment_recorded", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).not.toBeNull();
            if (result) {
              expect(result.newSubscriptionStatus).toBe("active");
              expect(result.newPlatformStatus).toBe(platformStatus);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("no overdue → no suspend", () => {
    it("already active subscription and non-suspended platform + payment_recorded → null (no change)", () => {
      fc.assert(
        fc.property(
          platformStatusArb.filter((s) => s !== "suspended"),
          invoiceIdArb,
          fc.boolean(),
          (platformStatus, invoiceId, gracePeriodActive) => {
            const state: BillingState = {
              subscriptionStatus: "active",
              platformStatus,
              gracePeriodActive,
            };
            const event: BillingEvent = { type: "payment_recorded", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it("already suspended/disabled platform + grace_period_ended → no further suspension", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("suspended" as const, "disabled" as const),
          invoiceIdArb,
          fc.boolean(),
          (platformStatus, invoiceId, gracePeriodActive) => {
            const state: BillingState = {
              subscriptionStatus: "past_due",
              platformStatus,
              gracePeriodActive,
            };
            const event: BillingEvent = { type: "grace_period_ended", invoiceId };
            const result = applyBillingEvent(state, event);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
