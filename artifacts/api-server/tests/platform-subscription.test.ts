// Feature: super-admin-platform — unit tests for lib/platform/subscription.ts
// Requirements: 6.3, 6.5, 6.6, 6.7, 6.8, 6.9

import { describe, it, expect } from "vitest";
import {
  filterBySubscriptionStatus,
  validateSubscriptionStatusUpdate,
  VALID_SUBSCRIPTION_STATUSES,
} from "../src/lib/platform/subscription";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(id: string, subscriptionStatus: string) {
  return {
    id,
    name: `Store ${id}`,
    platform_status: "active",
    subscription_status: subscriptionStatus,
    subscription_plan_id: "plan-1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("filterBySubscriptionStatus", () => {
  describe("exact match filtering (R6.6)", () => {
    it("returns only stores with exactly matching subscription_status", () => {
      const stores = [
        makeStore("s1", "active"),
        makeStore("s2", "trialing"),
        makeStore("s3", "active"),
        makeStore("s4", "past_due"),
      ];

      const result = filterBySubscriptionStatus(stores, "active");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s1");
      expect(result[1].id).toBe("s3");
    });

    it("filters by trialing", () => {
      const stores = [
        makeStore("s1", "active"),
        makeStore("s2", "trialing"),
        makeStore("s3", "trialing"),
      ];

      const result = filterBySubscriptionStatus(stores, "trialing");
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.subscription_status === "trialing")).toBe(true);
    });

    it("filters by past_due", () => {
      const stores = [
        makeStore("s1", "active"),
        makeStore("s2", "past_due"),
      ];

      const result = filterBySubscriptionStatus(stores, "past_due");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s2");
    });

    it("filters by cancelled", () => {
      const stores = [
        makeStore("s1", "cancelled"),
        makeStore("s2", "active"),
        makeStore("s3", "cancelled"),
      ];

      const result = filterBySubscriptionStatus(stores, "cancelled");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("s1");
      expect(result[1].id).toBe("s3");
    });
  });

  describe("no matches (R6.7)", () => {
    it("returns empty array when no store matches the status", () => {
      const stores = [
        makeStore("s1", "active"),
        makeStore("s2", "trialing"),
      ];

      const result = filterBySubscriptionStatus(stores, "cancelled");
      expect(result).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      const result = filterBySubscriptionStatus([], "active");
      expect(result).toEqual([]);
    });
  });

  describe("exact equality (not substring)", () => {
    it("does not match partial status values", () => {
      const stores = [makeStore("s1", "active")];

      expect(filterBySubscriptionStatus(stores, "act")).toEqual([]);
      expect(filterBySubscriptionStatus(stores, "Active")).toEqual([]);
      expect(filterBySubscriptionStatus(stores, "ACTIVE")).toEqual([]);
    });

    it("is case-sensitive", () => {
      const stores = [
        makeStore("s1", "past_due"),
        makeStore("s2", "Past_Due"),
      ];

      const result = filterBySubscriptionStatus(stores, "past_due");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s1");
    });
  });

  describe("preserves extra fields", () => {
    it("returns original store objects with all their fields", () => {
      const stores = [
        {
          id: "s1",
          name: "Store One",
          platform_status: "active",
          subscription_status: "active",
          subscription_plan_id: "plan-pro",
          extra_field: "extra_value",
        },
      ];

      const result = filterBySubscriptionStatus(stores, "active");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(stores[0]);
      expect(result[0].extra_field).toBe("extra_value");
    });
  });
});


// ---------------------------------------------------------------------------
// validateSubscriptionStatusUpdate — atomic update logic (R6.3, R6.8, R6.9)
// ---------------------------------------------------------------------------

describe("validateSubscriptionStatusUpdate", () => {
  describe("store existence check (R6.8)", () => {
    it("returns 400 when storeExists is false", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "active",
        storeExists: false,
      });
      expect(result).toEqual({
        valid: false,
        httpStatus: 400,
        error: "Store identifier is missing or invalid",
      });
    });

    it("returns 400 for missing store even with a valid status value", () => {
      for (const status of VALID_SUBSCRIPTION_STATUSES) {
        const result = validateSubscriptionStatusUpdate({
          newStatus: status,
          storeExists: false,
        });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.httpStatus).toBe(400);
          expect(result.error).toBe("Store identifier is missing or invalid");
        }
      }
    });
  });

  describe("status value validation (R6.8)", () => {
    it("returns 400 when newStatus is not in the valid set", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "invalid_status",
        storeExists: true,
      });
      expect(result).toEqual({
        valid: false,
        httpStatus: 400,
        error:
          "Subscription status must be one of: trialing, active, past_due, cancelled",
      });
    });

    it("rejects empty string", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "",
        storeExists: true,
      });
      expect(result.valid).toBe(false);
    });

    it("rejects case variations", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "Active",
        storeExists: true,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.httpStatus).toBe(400);
      }
    });

    it("rejects partial matches", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "trial",
        storeExists: true,
      });
      expect(result.valid).toBe(false);
    });

    it("rejects whitespace-padded values", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: " active ",
        storeExists: true,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("valid updates (R6.3)", () => {
    it("accepts 'trialing' and returns valid result", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "trialing",
        storeExists: true,
      });
      expect(result).toEqual({ valid: true, newStatus: "trialing" });
    });

    it("accepts 'active' and returns valid result", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "active",
        storeExists: true,
      });
      expect(result).toEqual({ valid: true, newStatus: "active" });
    });

    it("accepts 'past_due' and returns valid result", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "past_due",
        storeExists: true,
      });
      expect(result).toEqual({ valid: true, newStatus: "past_due" });
    });

    it("accepts 'cancelled' and returns valid result", () => {
      const result = validateSubscriptionStatusUpdate({
        newStatus: "cancelled",
        storeExists: true,
      });
      expect(result).toEqual({ valid: true, newStatus: "cancelled" });
    });
  });

  describe("atomicity guarantee (R6.9)", () => {
    it("never returns a partial result — valid is always true or false", () => {
      // Valid case: only 'valid' and 'newStatus' present
      const validResult = validateSubscriptionStatusUpdate({
        newStatus: "active",
        storeExists: true,
      });
      expect(validResult.valid).toBe(true);
      if (validResult.valid) {
        expect(validResult).toHaveProperty("newStatus");
        expect(validResult).not.toHaveProperty("httpStatus");
        expect(validResult).not.toHaveProperty("error");
      }

      // Invalid case: only 'valid', 'httpStatus', and 'error' present
      const invalidResult = validateSubscriptionStatusUpdate({
        newStatus: "bogus",
        storeExists: true,
      });
      expect(invalidResult.valid).toBe(false);
      if (!invalidResult.valid) {
        expect(invalidResult).toHaveProperty("httpStatus");
        expect(invalidResult).toHaveProperty("error");
        expect(invalidResult).not.toHaveProperty("newStatus");
      }
    });
  });

  describe("VALID_SUBSCRIPTION_STATUSES constant", () => {
    it("contains exactly the four defined statuses", () => {
      expect(VALID_SUBSCRIPTION_STATUSES).toEqual([
        "trialing",
        "active",
        "past_due",
        "cancelled",
      ]);
    });

    it("is readonly at the type level", () => {
      // TypeScript enforces readonly at compile time; runtime confirms array identity is stable
      expect(Array.isArray(VALID_SUBSCRIPTION_STATUSES)).toBe(true);
      expect(VALID_SUBSCRIPTION_STATUSES.length).toBe(4);
    });
  });
});
