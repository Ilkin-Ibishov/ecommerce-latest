// Feature: super-admin-platform
// Unit tests for lib/platform/plans.ts — plan validation, guards, and assignment invariant

import { describe, it, expect } from "vitest";
import {
  validatePlanCreate,
  validatePlanEdit,
  canArchivePlan,
  canDeletePlan,
  canAssignPlan,
  getAssignablePlans,
  type PlanRecord,
  type PlanCreateInput,
} from "../src/lib/platform/plans";

// ─── Test Fixtures ──────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: "plan-1",
    name: "Basic Plan",
    name_normalized: "basic plan",
    price: 29.99,
    billing_interval: "monthly",
    feature_flags: {},
    quota_limits: {},
    archived: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanCreateInput> = {}): PlanCreateInput {
  return {
    name: "New Plan",
    price: 49.99,
    billing_interval: "monthly",
    ...overrides,
  };
}

// ─── validatePlanCreate ─────────────────────────────────────────────────────────

describe("validatePlanCreate", () => {
  it("returns valid for a correct input with no collisions", () => {
    const result = validatePlanCreate(makeInput(), []);
    expect(result).toEqual({ valid: true });
  });

  it("returns 400 when name is empty", () => {
    const result = validatePlanCreate(makeInput({ name: "" }), []);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["name must be 1 to 120 characters"],
    });
  });

  it("returns 400 when name is only whitespace", () => {
    const result = validatePlanCreate(makeInput({ name: "   " }), []);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["name must be 1 to 120 characters"],
    });
  });

  it("returns 400 when name exceeds 120 characters", () => {
    const longName = "a".repeat(121);
    const result = validatePlanCreate(makeInput({ name: longName }), []);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["name must be 1 to 120 characters"],
    });
  });

  it("accepts a name of exactly 120 characters", () => {
    const name120 = "a".repeat(120);
    const result = validatePlanCreate(makeInput({ name: name120 }), []);
    expect(result).toEqual({ valid: true });
  });

  it("returns 400 when price is negative", () => {
    const result = validatePlanCreate(makeInput({ price: -1 }), []);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["price must be between 0 and 999999999.99"],
    });
  });

  it("returns 400 when price exceeds max", () => {
    const result = validatePlanCreate(makeInput({ price: 1000000000 }), []);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["price must be between 0 and 999999999.99"],
    });
  });

  it("accepts price of 0", () => {
    const result = validatePlanCreate(makeInput({ price: 0 }), []);
    expect(result).toEqual({ valid: true });
  });

  it("accepts price at max boundary", () => {
    const result = validatePlanCreate(makeInput({ price: 999999999.99 }), []);
    expect(result).toEqual({ valid: true });
  });

  it("returns 400 when billing_interval is invalid", () => {
    const result = validatePlanCreate(
      makeInput({ billing_interval: "weekly" }),
      [],
    );
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["billing_interval must be monthly or yearly"],
    });
  });

  it("accepts monthly billing_interval", () => {
    const result = validatePlanCreate(
      makeInput({ billing_interval: "monthly" }),
      [],
    );
    expect(result).toEqual({ valid: true });
  });

  it("accepts yearly billing_interval", () => {
    const result = validatePlanCreate(
      makeInput({ billing_interval: "yearly" }),
      [],
    );
    expect(result).toEqual({ valid: true });
  });

  it("collects multiple validation errors", () => {
    const result = validatePlanCreate(
      makeInput({ name: "", price: -5, billing_interval: "bad" }),
      [],
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.httpStatus).toBe(400);
      expect(result.errors).toHaveLength(3);
    }
  });

  it("returns 409 on case-insensitive name collision", () => {
    const existing = [makePlan({ name: "Pro Plan", name_normalized: "pro plan" })];
    const result = validatePlanCreate(makeInput({ name: "PRO PLAN" }), existing);
    expect(result).toEqual({
      valid: false,
      httpStatus: 409,
      errors: ["a plan with this name already exists"],
    });
  });

  it("does not return 409 when name differs case-insensitively", () => {
    const existing = [makePlan({ name: "Pro Plan", name_normalized: "pro plan" })];
    const result = validatePlanCreate(
      makeInput({ name: "Pro Plan Plus" }),
      existing,
    );
    expect(result).toEqual({ valid: true });
  });
});

// ─── validatePlanEdit ───────────────────────────────────────────────────────────

describe("validatePlanEdit", () => {
  const currentPlan = makePlan({ id: "plan-current" });

  it("returns valid for a valid partial edit", () => {
    const result = validatePlanEdit({ price: 59.99 }, currentPlan, [currentPlan]);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid for empty input (no changes)", () => {
    const result = validatePlanEdit({}, currentPlan, [currentPlan]);
    expect(result).toEqual({ valid: true });
  });

  it("validates name only when provided", () => {
    const result = validatePlanEdit({ name: "" }, currentPlan, [currentPlan]);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["name must be 1 to 120 characters"],
    });
  });

  it("validates price only when provided", () => {
    const result = validatePlanEdit({ price: -1 }, currentPlan, [currentPlan]);
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["price must be between 0 and 999999999.99"],
    });
  });

  it("validates billing_interval only when provided", () => {
    const result = validatePlanEdit(
      { billing_interval: "weekly" },
      currentPlan,
      [currentPlan],
    );
    expect(result).toEqual({
      valid: false,
      httpStatus: 400,
      errors: ["billing_interval must be monthly or yearly"],
    });
  });

  it("excludes the current plan from name collision check", () => {
    // Renaming to same name (case-insensitive) → should pass (it's the same plan)
    const result = validatePlanEdit(
      { name: "BASIC PLAN" },
      currentPlan,
      [currentPlan],
    );
    expect(result).toEqual({ valid: true });
  });

  it("returns 409 when renaming collides with a different plan", () => {
    const otherPlan = makePlan({
      id: "plan-other",
      name: "Premium",
      name_normalized: "premium",
    });
    const result = validatePlanEdit(
      { name: "PREMIUM" },
      currentPlan,
      [currentPlan, otherPlan],
    );
    expect(result).toEqual({
      valid: false,
      httpStatus: 409,
      errors: ["a plan with this name already exists"],
    });
  });
});

// ─── canArchivePlan ─────────────────────────────────────────────────────────────

describe("canArchivePlan", () => {
  it("returns success when no stores are assigned", () => {
    expect(canArchivePlan("plan-1", 0)).toEqual({ success: true });
  });

  it("returns 409 when stores are assigned", () => {
    expect(canArchivePlan("plan-1", 3)).toEqual({
      success: false,
      httpStatus: 409,
      error: "Plan has assigned stores",
    });
  });
});

// ─── canDeletePlan ──────────────────────────────────────────────────────────────

describe("canDeletePlan", () => {
  it("returns success when no stores are assigned", () => {
    expect(canDeletePlan("plan-1", 0)).toEqual({ success: true });
  });

  it("returns 409 when stores are assigned", () => {
    expect(canDeletePlan("plan-1", 1)).toEqual({
      success: false,
      httpStatus: 409,
      error: "Plan has assigned stores",
    });
  });
});

// ─── canAssignPlan ──────────────────────────────────────────────────────────────

describe("canAssignPlan", () => {
  it("returns success when plan exists and is not archived", () => {
    const plans = [makePlan({ id: "plan-1", archived: false })];
    expect(canAssignPlan("plan-1", plans)).toEqual({ success: true });
  });

  it("returns 409 'Plan not found' when plan does not exist", () => {
    const plans = [makePlan({ id: "plan-1" })];
    expect(canAssignPlan("plan-missing", plans)).toEqual({
      success: false,
      httpStatus: 409,
      error: "Plan not found",
    });
  });

  it("returns 409 'Plan is archived' when plan exists but is archived", () => {
    const plans = [makePlan({ id: "plan-1", archived: true })];
    expect(canAssignPlan("plan-1", plans)).toEqual({
      success: false,
      httpStatus: 409,
      error: "Plan is archived",
    });
  });

  it("distinguishes not-found from archived", () => {
    const plans = [makePlan({ id: "plan-1", archived: true })];
    const notFound = canAssignPlan("plan-other", plans);
    const archived = canAssignPlan("plan-1", plans);

    expect(notFound).not.toEqual(archived);
    if (!notFound.success && !archived.success) {
      expect(notFound.error).toBe("Plan not found");
      expect(archived.error).toBe("Plan is archived");
    }
  });
});

// ─── getAssignablePlans ─────────────────────────────────────────────────────────

describe("getAssignablePlans", () => {
  it("returns only non-archived plans", () => {
    const plans = [
      makePlan({ id: "p1", archived: false }),
      makePlan({ id: "p2", archived: true }),
      makePlan({ id: "p3", archived: false }),
    ];
    const result = getAssignablePlans(plans);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("returns empty array when all plans are archived", () => {
    const plans = [
      makePlan({ id: "p1", archived: true }),
      makePlan({ id: "p2", archived: true }),
    ];
    expect(getAssignablePlans(plans)).toEqual([]);
  });

  it("returns all plans when none are archived", () => {
    const plans = [
      makePlan({ id: "p1", archived: false }),
      makePlan({ id: "p2", archived: false }),
    ];
    expect(getAssignablePlans(plans)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(getAssignablePlans([])).toEqual([]);
  });
});
