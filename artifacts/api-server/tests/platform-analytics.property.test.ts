import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 31: Analytics figures are correct aggregations with empty-state zeros

import {
  computeAnalytics,
  type StoreRecord,
  type PlanRecord,
  type StatusTransitionRecord,
} from "../src/lib/platform/analytics";

// ─── Generators ────────────────────────────────────────────────────────────────

const subscriptionStatusArb = fc.constantFrom(
  "trialing" as const,
  "active" as const,
  "past_due" as const,
  "cancelled" as const,
);

const billingIntervalArb = fc.constantFrom("monthly" as const, "yearly" as const);

const planRecordArb: fc.Arbitrary<PlanRecord> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  price: fc.double({ min: 0.01, max: 9999.99, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  billing_interval: billingIntervalArb,
});

const isoDateArb = fc
  .date({ min: new Date("2023-01-01"), max: new Date("2025-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const storeRecordArb = (planIds: string[]): fc.Arbitrary<StoreRecord> =>
  fc.record({
    id: fc.uuid(),
    subscription_status: subscriptionStatusArb,
    subscription_plan_id: planIds.length > 0
      ? fc.oneof(fc.constantFrom(...planIds), fc.constant(null))
      : fc.constant(null),
    created_at: isoDateArb,
  });

const transitionRecordArb: fc.Arbitrary<StatusTransitionRecord> = fc.record({
  store_id: fc.uuid(),
  new_status: fc.constantFrom("active", "past_due", "cancelled", "trialing"),
  timestamp: isoDateArb,
});

// ─── Property 31: Analytics figures are correct aggregations ─────────────────────

describe("Feature: super-admin-platform, Property 31: Analytics figures are correct aggregations with empty-state zeros", () => {
  describe("empty input → all zeros", () => {
    it("no stores, no plans, no transitions → all zero results", () => {
      fc.assert(
        fc.property(isoDateArb, isoDateArb, (from, to) => {
          const result = computeAnalytics({
            stores: [],
            plans: [],
            transitions: [],
            periodFrom: from,
            periodTo: to,
          });
          expect(result.mrr).toBe("0.00");
          expect(result.active_count).toBe(0);
          expect(result.past_due_count).toBe(0);
          expect(result.cancelled_count).toBe(0);
          expect(result.new_stores).toBe(0);
          expect(result.churned_stores).toBe(0);
          expect(result.revenue_by_plan).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("MRR from active stores", () => {
    it("MRR sums monthly-normalized prices of active stores with plans", () => {
      fc.assert(
        fc.property(
          fc.array(planRecordArb, { minLength: 1, maxLength: 3 }),
          (plans) => {
            // Create all-active stores with known plan assignments
            const stores: StoreRecord[] = plans.map((plan) => ({
              id: `store-${plan.id}`,
              subscription_status: "active" as const,
              subscription_plan_id: plan.id,
              created_at: "2024-01-01",
            }));

            const result = computeAnalytics({
              stores,
              plans,
              transitions: [],
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            // Manually compute expected MRR
            let expectedMrr = 0;
            for (const plan of plans) {
              expectedMrr += plan.billing_interval === "yearly" ? plan.price / 12 : plan.price;
            }
            expect(result.mrr).toBe(expectedMrr.toFixed(2));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("non-active stores do not contribute to MRR", () => {
      fc.assert(
        fc.property(
          planRecordArb,
          subscriptionStatusArb.filter((s) => s !== "active"),
          (plan, status) => {
            const stores: StoreRecord[] = [
              { id: "store-1", subscription_status: status, subscription_plan_id: plan.id, created_at: "2024-01-01" },
            ];
            const result = computeAnalytics({
              stores,
              plans: [plan],
              transitions: [],
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });
            expect(result.mrr).toBe("0.00");
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("counts are correct", () => {
    it("active_count, past_due_count, cancelled_count match store statuses", () => {
      fc.assert(
        fc.property(
          fc.array(subscriptionStatusArb, { minLength: 0, maxLength: 20 }),
          (statuses) => {
            const stores: StoreRecord[] = statuses.map((status, i) => ({
              id: `store-${i}`,
              subscription_status: status,
              subscription_plan_id: null,
              created_at: "2024-06-01",
            }));

            const result = computeAnalytics({
              stores,
              plans: [],
              transitions: [],
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            const expectedActive = statuses.filter((s) => s === "active").length;
            const expectedPastDue = statuses.filter((s) => s === "past_due").length;
            const expectedCancelled = statuses.filter((s) => s === "cancelled").length;

            expect(result.active_count).toBe(expectedActive);
            expect(result.past_due_count).toBe(expectedPastDue);
            expect(result.cancelled_count).toBe(expectedCancelled);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("new/churned within period", () => {
    it("new_stores counts stores whose created_at falls within [periodFrom, periodTo]", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10 }),
          fc.nat({ max: 10 }),
          (inPeriodCount, outOfPeriodCount) => {
            const stores: StoreRecord[] = [];
            // Stores created within period
            for (let i = 0; i < inPeriodCount; i++) {
              stores.push({ id: `in-${i}`, subscription_status: "active", subscription_plan_id: null, created_at: "2024-06-15" });
            }
            // Stores created outside period
            for (let i = 0; i < outOfPeriodCount; i++) {
              stores.push({ id: `out-${i}`, subscription_status: "active", subscription_plan_id: null, created_at: "2023-01-01" });
            }

            const result = computeAnalytics({
              stores,
              plans: [],
              transitions: [],
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            expect(result.new_stores).toBe(inPeriodCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("churned_stores counts transitions to cancelled within period", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10 }),
          fc.nat({ max: 10 }),
          (inPeriodChurn, outOfPeriodChurn) => {
            const transitions: StatusTransitionRecord[] = [];
            // Churn within period
            for (let i = 0; i < inPeriodChurn; i++) {
              transitions.push({ store_id: `churn-${i}`, new_status: "cancelled", timestamp: "2024-06-15" });
            }
            // Churn outside period
            for (let i = 0; i < outOfPeriodChurn; i++) {
              transitions.push({ store_id: `old-churn-${i}`, new_status: "cancelled", timestamp: "2023-01-01" });
            }
            // Non-churn transitions within period (should not count)
            transitions.push({ store_id: "active-1", new_status: "active", timestamp: "2024-06-15" });

            const result = computeAnalytics({
              stores: [],
              plans: [],
              transitions,
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            expect(result.churned_stores).toBe(inPeriodChurn);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("revenue-by-plan consistency", () => {
    it("sum of revenue_by_plan entries equals MRR (within floating point tolerance)", () => {
      fc.assert(
        fc.property(
          fc.array(planRecordArb, { minLength: 1, maxLength: 3 }),
          (plans) => {
            // Ensure unique plan IDs to avoid deduplication issues
            const uniquePlans = plans.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
            if (uniquePlans.length === 0) return;

            const stores: StoreRecord[] = uniquePlans.map((plan, i) => ({
              id: `store-${i}`,
              subscription_status: "active" as const,
              subscription_plan_id: plan.id,
              created_at: "2024-01-01",
            }));

            const result = computeAnalytics({
              stores,
              plans: uniquePlans,
              transitions: [],
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            // Sum of revenue_by_plan revenues should equal MRR
            // Both are computed from the same internal sum, so they should match exactly
            const revenueSum = result.revenue_by_plan.reduce(
              (acc, entry) => acc + parseFloat(entry.revenue),
              0,
            );
            // Allow 0.01 tolerance due to independent toFixed(2) rounding per plan entry
            expect(Math.abs(revenueSum - parseFloat(result.mrr))).toBeLessThanOrEqual(0.01 * uniquePlans.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("revenue_by_plan includes only plans with active stores", () => {
      fc.assert(
        fc.property(planRecordArb, (plan) => {
          // Only cancelled stores on this plan
          const stores: StoreRecord[] = [
            { id: "store-1", subscription_status: "cancelled", subscription_plan_id: plan.id, created_at: "2024-01-01" },
          ];
          const result = computeAnalytics({
            stores,
            plans: [plan],
            transitions: [],
            periodFrom: "2024-01-01",
            periodTo: "2024-12-31",
          });
          expect(result.revenue_by_plan).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("monetary values are 2dp strings, counts are non-negative integers", () => {
    it("all monetary fields are formatted as 2dp strings", () => {
      fc.assert(
        fc.property(
          fc.array(planRecordArb, { minLength: 0, maxLength: 3 }),
          fc.array(transitionRecordArb, { minLength: 0, maxLength: 5 }),
          (plans, transitions) => {
            const planIds = plans.map((p) => p.id);
            const stores: StoreRecord[] = plans.map((plan, i) => ({
              id: `store-${i}`,
              subscription_status: "active" as const,
              subscription_plan_id: plan.id,
              created_at: "2024-06-01",
            }));

            const result = computeAnalytics({
              stores,
              plans,
              transitions,
              periodFrom: "2024-01-01",
              periodTo: "2024-12-31",
            });

            // MRR is a 2dp string
            expect(result.mrr).toMatch(/^\d+\.\d{2}$/);
            // All revenue_by_plan entries are 2dp strings
            for (const entry of result.revenue_by_plan) {
              expect(entry.revenue).toMatch(/^\d+\.\d{2}$/);
            }
            // All counts are non-negative integers
            expect(Number.isInteger(result.active_count)).toBe(true);
            expect(result.active_count).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.past_due_count)).toBe(true);
            expect(result.past_due_count).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.cancelled_count)).toBe(true);
            expect(result.cancelled_count).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.new_stores)).toBe(true);
            expect(result.new_stores).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.churned_stores)).toBe(true);
            expect(result.churned_stores).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
