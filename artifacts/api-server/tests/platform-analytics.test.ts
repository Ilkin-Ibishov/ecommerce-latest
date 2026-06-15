// Feature: super-admin-platform — unit tests for lib/platform/analytics.ts
// Requirements: 19.1, 19.2, 19.3, 19.8, 19.9

import { describe, it, expect } from "vitest";
import {
  computeAnalytics,
  type StoreRecord,
  type PlanRecord,
  type StatusTransitionRecord,
} from "../src/lib/platform/analytics";

describe("computeAnalytics", () => {
  const periodFrom = "2024-01-01";
  const periodTo = "2024-01-31";

  const monthlyPlan: PlanRecord = {
    id: "plan-monthly",
    name: "Monthly Pro",
    price: 99,
    billing_interval: "monthly",
  };

  const yearlyPlan: PlanRecord = {
    id: "plan-yearly",
    name: "Yearly Enterprise",
    price: 1200,
    billing_interval: "yearly",
  };

  describe("empty input returns all zeros (R19.9)", () => {
    it("returns zeros when no stores, no plans, no transitions", () => {
      const result = computeAnalytics({
        stores: [],
        plans: [],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result).toEqual({
        mrr: "0.00",
        active_count: 0,
        past_due_count: 0,
        cancelled_count: 0,
        new_stores: 0,
        churned_stores: 0,
        revenue_by_plan: [],
      });
    });
  });

  describe("status counts (R19.1)", () => {
    it("counts active, past_due, and cancelled stores correctly", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-06-01T00:00:00Z" },
        { id: "s2", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-07-01T00:00:00Z" },
        { id: "s3", subscription_status: "past_due", subscription_plan_id: "plan-monthly", created_at: "2023-08-01T00:00:00Z" },
        { id: "s4", subscription_status: "cancelled", subscription_plan_id: null, created_at: "2023-09-01T00:00:00Z" },
        { id: "s5", subscription_status: "trialing", subscription_plan_id: null, created_at: "2023-10-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.active_count).toBe(2);
      expect(result.past_due_count).toBe(1);
      expect(result.cancelled_count).toBe(1);
    });
  });

  describe("MRR calculation (R19.1)", () => {
    it("sums monthly-normalized prices for active stores only", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s2", subscription_status: "active", subscription_plan_id: "plan-yearly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s3", subscription_status: "past_due", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan, yearlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      // MRR = 99 (monthly) + 1200/12 (yearly) = 99 + 100 = 199
      expect(result.mrr).toBe("199.00");
    });

    it("returns 0.00 MRR when no stores are active", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "past_due", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.mrr).toBe("0.00");
    });

    it("ignores active stores without a plan assignment", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: null, created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.mrr).toBe("0.00");
    });

    it("formats MRR to exactly 2 decimal places", () => {
      // yearly plan: 1000 / 12 = 83.333...
      const oddPlan: PlanRecord = { id: "plan-odd", name: "Odd", price: 1000, billing_interval: "yearly" };
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "plan-odd", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [oddPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.mrr).toBe("83.33");
    });
  });

  describe("new stores within period (R19.2)", () => {
    it("counts stores created within the inclusive period", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: null, created_at: "2024-01-01T00:00:00Z" }, // on start boundary
        { id: "s2", subscription_status: "active", subscription_plan_id: null, created_at: "2024-01-15T12:00:00Z" }, // in the middle
        { id: "s3", subscription_status: "active", subscription_plan_id: null, created_at: "2024-01-31T23:59:59Z" }, // on end boundary
        { id: "s4", subscription_status: "active", subscription_plan_id: null, created_at: "2023-12-31T23:59:59Z" }, // before period
        { id: "s5", subscription_status: "active", subscription_plan_id: null, created_at: "2024-02-01T00:00:00Z" }, // after period
      ];

      const result = computeAnalytics({
        stores,
        plans: [],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.new_stores).toBe(3);
    });
  });

  describe("churned stores within period (R19.2)", () => {
    it("counts transitions to cancelled within the inclusive period", () => {
      const transitions: StatusTransitionRecord[] = [
        { store_id: "s1", new_status: "cancelled", timestamp: "2024-01-15T10:00:00Z" },
        { store_id: "s2", new_status: "cancelled", timestamp: "2024-01-01T00:00:00Z" }, // boundary start
        { store_id: "s3", new_status: "cancelled", timestamp: "2024-01-31T23:59:59Z" }, // boundary end
        { store_id: "s4", new_status: "cancelled", timestamp: "2023-12-31T23:59:59Z" }, // before
        { store_id: "s5", new_status: "active", timestamp: "2024-01-20T00:00:00Z" }, // different status
      ];

      const result = computeAnalytics({
        stores: [],
        plans: [],
        transitions,
        periodFrom,
        periodTo,
      });

      expect(result.churned_stores).toBe(3);
    });
  });

  describe("revenue by plan (R19.3)", () => {
    it("groups revenue by plan for active stores only", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s2", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s3", subscription_status: "active", subscription_plan_id: "plan-yearly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s4", subscription_status: "past_due", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan, yearlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      // Monthly Pro: 99 * 2 active = 198.00
      // Yearly Enterprise: 1200/12 * 1 active = 100.00
      expect(result.revenue_by_plan).toHaveLength(2);

      const monthlyGroup = result.revenue_by_plan.find((r) => r.plan_id === "plan-monthly");
      const yearlyGroup = result.revenue_by_plan.find((r) => r.plan_id === "plan-yearly");

      expect(monthlyGroup).toEqual({ plan_id: "plan-monthly", plan_name: "Monthly Pro", revenue: "198.00" });
      expect(yearlyGroup).toEqual({ plan_id: "plan-yearly", plan_name: "Yearly Enterprise", revenue: "100.00" });
    });

    it("revenue_by_plan sums consistently with MRR", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
        { id: "s2", subscription_status: "active", subscription_plan_id: "plan-yearly", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan, yearlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      const totalRevenue = result.revenue_by_plan.reduce(
        (sum, r) => sum + parseFloat(r.revenue),
        0,
      );

      expect(parseFloat(result.mrr)).toBeCloseTo(totalRevenue, 2);
    });

    it("returns empty revenue_by_plan when no active stores exist", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "cancelled", subscription_plan_id: "plan-monthly", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      expect(result.revenue_by_plan).toEqual([]);
    });
  });

  describe("consistency with Control_Plane records only (R19.8)", () => {
    it("ignores active stores with unknown plan ids (not in provided plans)", () => {
      const stores: StoreRecord[] = [
        { id: "s1", subscription_status: "active", subscription_plan_id: "unknown-plan", created_at: "2023-01-01T00:00:00Z" },
      ];

      const result = computeAnalytics({
        stores,
        plans: [monthlyPlan],
        transitions: [],
        periodFrom,
        periodTo,
      });

      // Still counted as active, but no MRR contribution
      expect(result.active_count).toBe(1);
      expect(result.mrr).toBe("0.00");
      expect(result.revenue_by_plan).toEqual([]);
    });
  });
});
