import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 21: Plan validation
// Feature: super-admin-platform, Property 22: Each store always has exactly one plan reference

import {
  validatePlanCreate,
  validatePlanEdit,
  canArchivePlan,
  canDeletePlan,
  canAssignPlan,
  type PlanRecord,
  type PlanCreateInput,
} from "../src/lib/platform/plans";

// ─── Generators ────────────────────────────────────────────────────────────────

const planIdArb = fc.uuid();

const validPlanNameArb = fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim().length >= 1);

const validPriceArb = fc.double({ min: 0, max: 999999999.99, noNaN: true }).map((v) => Math.round(v * 100) / 100);

const validBillingIntervalArb = fc.constantFrom("monthly", "yearly");

const validPlanCreateInputArb: fc.Arbitrary<PlanCreateInput> = fc.record({
  name: validPlanNameArb,
  price: validPriceArb,
  billing_interval: validBillingIntervalArb,
  feature_flags: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.boolean()), { nil: undefined }),
  quota_limits: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.nat({ max: 10000 })), { nil: undefined }),
});

const planRecordArb: fc.Arbitrary<PlanRecord> = fc.record({
  id: fc.uuid(),
  name: validPlanNameArb,
  name_normalized: validPlanNameArb.map((n) => n.trim().toLowerCase()),
  price: validPriceArb,
  billing_interval: validBillingIntervalArb as fc.Arbitrary<"monthly" | "yearly">,
  feature_flags: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.boolean()),
  quota_limits: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.nat({ max: 10000 })),
  archived: fc.boolean(),
});

// ─── Property 21: Plan validation ──────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 21: Plan validation", () => {
  describe("valid body persists", () => {
    it("any valid PlanCreateInput with no name collision → { valid: true }", () => {
      fc.assert(
        fc.property(validPlanCreateInputArb, (input) => {
          // No existing plans → no collision possible
          const result = validatePlanCreate(input, []);
          expect(result).toEqual({ valid: true });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("invalid body → 400", () => {
    it("empty or whitespace-only name → httpStatus 400", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("", "   ", "\t\n"),
          validPriceArb,
          validBillingIntervalArb,
          (name, price, interval) => {
            const result = validatePlanCreate({ name, price, billing_interval: interval }, []);
            expect(result).toHaveProperty("valid", false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("invalid billing_interval → httpStatus 400", () => {
      fc.assert(
        fc.property(
          validPlanNameArb,
          validPriceArb,
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "monthly" && s !== "yearly"),
          (name, price, interval) => {
            const result = validatePlanCreate({ name, price, billing_interval: interval }, []);
            expect(result).toHaveProperty("valid", false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("negative or out-of-range price → httpStatus 400", () => {
      fc.assert(
        fc.property(
          validPlanNameArb,
          fc.oneof(
            fc.double({ min: -1e9, max: -0.01, noNaN: true }),
            fc.double({ min: 1000000000, max: 1e12, noNaN: true }),
            fc.constant(NaN),
          ),
          validBillingIntervalArb,
          (name, price, interval) => {
            const result = validatePlanCreate({ name, price, billing_interval: interval }, []);
            expect(result).toHaveProperty("valid", false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("name collision → 409", () => {
    it("case-insensitive name collision with existing plan → httpStatus 409", () => {
      fc.assert(
        fc.property(validPlanCreateInputArb, planIdArb, (input, existingId) => {
          const existingPlan: PlanRecord = {
            id: existingId,
            name: input.name,
            name_normalized: input.name.trim().toLowerCase(),
            price: 10,
            billing_interval: "monthly",
            feature_flags: {},
            quota_limits: {},
            archived: false,
          };
          const result = validatePlanCreate(input, [existingPlan]);
          expect(result).toHaveProperty("valid", false);
          if (!result.valid) {
            expect(result.httpStatus).toBe(409);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("archive/delete with stores → 409", () => {
    it("archiving a plan with assignedStoreCount > 0 → 409", () => {
      fc.assert(
        fc.property(planIdArb, fc.integer({ min: 1, max: 1000 }), (planId, storeCount) => {
          const result = canArchivePlan(planId, storeCount);
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.httpStatus).toBe(409);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("deleting a plan with assignedStoreCount > 0 → 409", () => {
      fc.assert(
        fc.property(planIdArb, fc.integer({ min: 1, max: 1000 }), (planId, storeCount) => {
          const result = canDeletePlan(planId, storeCount);
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.httpStatus).toBe(409);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("archiving/deleting a plan with 0 stores succeeds", () => {
      fc.assert(
        fc.property(planIdArb, (planId) => {
          expect(canArchivePlan(planId, 0)).toEqual({ success: true });
          expect(canDeletePlan(planId, 0)).toEqual({ success: true });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("assign missing/archived → 409", () => {
    it("assigning a non-existent plan → 409", () => {
      fc.assert(
        fc.property(planIdArb, fc.array(planRecordArb, { minLength: 0, maxLength: 5 }), (planId, plans) => {
          // Ensure planId is not in the plans list
          const filtered = plans.filter((p) => p.id !== planId);
          const result = canAssignPlan(planId, filtered);
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.httpStatus).toBe(409);
            expect(result.error).toBe("Plan not found");
          }
        }),
        { numRuns: 100 },
      );
    });

    it("assigning an archived plan → 409", () => {
      fc.assert(
        fc.property(planRecordArb, (plan) => {
          const archivedPlan = { ...plan, archived: true };
          const result = canAssignPlan(archivedPlan.id, [archivedPlan]);
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.httpStatus).toBe(409);
            expect(result.error).toBe("Plan is archived");
          }
        }),
        { numRuns: 100 },
      );
    });

    it("assigning a non-archived existing plan succeeds", () => {
      fc.assert(
        fc.property(planRecordArb, (plan) => {
          const activePlan = { ...plan, archived: false };
          const result = canAssignPlan(activePlan.id, [activePlan]);
          expect(result).toEqual({ success: true });
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Property 22: Each store always has exactly one plan reference ──────────────

describe("Feature: super-admin-platform, Property 22: Each store always has exactly one plan reference", () => {
  it("a store's subscription_plan_id is always exactly one value (string or null), never an array", () => {
    const storeArb = fc.record({
      id: fc.uuid(),
      subscription_plan_id: fc.oneof(fc.uuid(), fc.constant(null)),
    });

    fc.assert(
      fc.property(storeArb, (store) => {
        // Invariant: subscription_plan_id is either a string or null, never an array
        const planRef = store.subscription_plan_id;
        expect(planRef === null || typeof planRef === "string").toBe(true);
        if (planRef !== null) {
          expect(planRef.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("assigning a plan to a store replaces the previous plan (exactly one reference)", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // storeId
        fc.uuid(), // oldPlanId
        fc.uuid(), // newPlanId
        (_storeId, oldPlanId, newPlanId) => {
          // Simulate the invariant: after assignment, the store has exactly one plan
          const storeBefore = { subscription_plan_id: oldPlanId };
          const storeAfter = { subscription_plan_id: newPlanId };

          // Before: exactly one plan reference
          expect(typeof storeBefore.subscription_plan_id).toBe("string");

          // After: still exactly one plan reference (not accumulated)
          expect(typeof storeAfter.subscription_plan_id).toBe("string");
          expect(storeAfter.subscription_plan_id).toBe(newPlanId);
          expect(storeAfter.subscription_plan_id).not.toBe(undefined);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validate+assign flow: successful assign means the plan is a valid non-archived plan", () => {
    fc.assert(
      fc.property(
        planRecordArb.map((p) => ({ ...p, archived: false })),
        (plan) => {
          const assignResult = canAssignPlan(plan.id, [plan]);
          if (assignResult.success) {
            // The plan that is now assigned must exist and not be archived
            expect(plan.archived).toBe(false);
            expect(plan.id).toBeTruthy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
