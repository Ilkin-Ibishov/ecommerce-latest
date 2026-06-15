// Unit tests for lib/billing/transition.ts — billing lifecycle reducer
// Feature: super-admin-platform
// Requirements: 6.10, 14.2, 14.3, 14.5, 14.6, 14.7, 14.10

import { describe, it, expect } from "vitest";
import {
  applyBillingEvent,
  type BillingState,
  type BillingEvent,
} from "../src/lib/billing/transition";

describe("applyBillingEvent", () => {
  const activeState: BillingState = {
    subscriptionStatus: "active",
    platformStatus: "active",
    gracePeriodActive: false,
  };

  const pastDueState: BillingState = {
    subscriptionStatus: "past_due",
    platformStatus: "active",
    gracePeriodActive: true,
  };

  const suspendedState: BillingState = {
    subscriptionStatus: "past_due",
    platformStatus: "suspended",
    gracePeriodActive: true,
  };

  describe("invoice_due_passed", () => {
    const event: BillingEvent = {
      type: "invoice_due_passed",
      invoiceId: "inv-1",
    };

    it("transitions active to past_due", () => {
      const result = applyBillingEvent(activeState, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("past_due");
      expect(result!.newPlatformStatus).toBe("active");
      expect(result!.endGracePeriod).toBe(false);
    });

    it("transitions trialing to past_due", () => {
      const trialingState: BillingState = {
        subscriptionStatus: "trialing",
        platformStatus: "active",
        gracePeriodActive: false,
      };
      const result = applyBillingEvent(trialingState, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("past_due");
    });

    it("returns null when already past_due (idempotent)", () => {
      const result = applyBillingEvent(pastDueState, event);
      expect(result).toBeNull();
    });

    it("returns null when cancelled", () => {
      const cancelledState: BillingState = {
        subscriptionStatus: "cancelled",
        platformStatus: "active",
        gracePeriodActive: false,
      };
      const result = applyBillingEvent(cancelledState, event);
      expect(result).toBeNull();
    });

    it("preserves platform status during transition", () => {
      const onboardingState: BillingState = {
        subscriptionStatus: "active",
        platformStatus: "onboarding",
        gracePeriodActive: false,
      };
      const result = applyBillingEvent(onboardingState, event);
      expect(result).not.toBeNull();
      expect(result!.newPlatformStatus).toBe("onboarding");
    });
  });

  describe("grace_period_ended", () => {
    const event: BillingEvent = {
      type: "grace_period_ended",
      invoiceId: "inv-1",
    };

    it("suspends when still past_due with active platform", () => {
      const result = applyBillingEvent(pastDueState, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("past_due");
      expect(result!.newPlatformStatus).toBe("suspended");
      expect(result!.endGracePeriod).toBe(true);
    });

    it("returns null when no longer past_due (payment came during grace)", () => {
      const result = applyBillingEvent(activeState, event);
      expect(result).toBeNull();
    });

    it("returns null when already suspended", () => {
      const result = applyBillingEvent(suspendedState, event);
      expect(result).toBeNull();
    });

    it("returns null when platform is disabled", () => {
      const disabledState: BillingState = {
        subscriptionStatus: "past_due",
        platformStatus: "disabled",
        gracePeriodActive: true,
      };
      const result = applyBillingEvent(disabledState, event);
      expect(result).toBeNull();
    });
  });

  describe("payment_recorded", () => {
    const event: BillingEvent = {
      type: "payment_recorded",
      invoiceId: "inv-1",
    };

    it("returns null when already active (no change needed)", () => {
      const result = applyBillingEvent(activeState, event);
      expect(result).toBeNull();
    });

    it("resolves past_due to active", () => {
      const result = applyBillingEvent(pastDueState, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("active");
      expect(result!.newPlatformStatus).toBe("active");
      expect(result!.endGracePeriod).toBe(true);
    });

    it("reactivates suspended store (non-payment suspension)", () => {
      const result = applyBillingEvent(suspendedState, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("active");
      expect(result!.newPlatformStatus).toBe("active");
      expect(result!.endGracePeriod).toBe(true);
    });

    it("handles suspended but not past_due (manual override case)", () => {
      const manualSuspend: BillingState = {
        subscriptionStatus: "active",
        platformStatus: "suspended",
        gracePeriodActive: false,
      };
      const result = applyBillingEvent(manualSuspend, event);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("active");
      expect(result!.newPlatformStatus).toBe("active");
      expect(result!.endGracePeriod).toBe(true);
    });

    it("includes descriptive action for audit", () => {
      const result = applyBillingEvent(pastDueState, event);
      expect(result).not.toBeNull();
      expect(result!.action).toContain("payment_recorded");
      expect(result!.action).toContain("inv-1");
    });
  });

  describe("no overdue → no auto-suspend (R14.10)", () => {
    it("active state with no events remains unchanged", () => {
      // Verify that without invoice_due_passed, grace_period_ended
      // produces no suspension
      const event: BillingEvent = {
        type: "grace_period_ended",
        invoiceId: "inv-1",
      };
      // Active subscription = payment came in, so grace_period_ended is a no-op
      const result = applyBillingEvent(activeState, event);
      expect(result).toBeNull();
    });
  });

  describe("manual mark-paid drives same transitions (R6.10)", () => {
    it("manual payment while past_due transitions to active", () => {
      // Manual mark-paid is the same payment_recorded event
      const manualPay: BillingEvent = {
        type: "payment_recorded",
        invoiceId: "manual-pay-1",
      };
      const result = applyBillingEvent(pastDueState, manualPay);
      expect(result).not.toBeNull();
      expect(result!.newSubscriptionStatus).toBe("active");
      expect(result!.endGracePeriod).toBe(true);
    });

    it("manual payment after suspension reactivates", () => {
      const manualPay: BillingEvent = {
        type: "payment_recorded",
        invoiceId: "manual-pay-2",
      };
      const result = applyBillingEvent(suspendedState, manualPay);
      expect(result).not.toBeNull();
      expect(result!.newPlatformStatus).toBe("active");
      expect(result!.newSubscriptionStatus).toBe("active");
    });
  });
});
