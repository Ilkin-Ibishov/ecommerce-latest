/**
 * Platform analytics aggregation — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 19.1, 19.2, 19.3, 19.8, 19.9
 *
 * Logic:
 * - MRR: sum of monthly-normalized prices for all active stores
 *   (yearly/12, monthly as-is), formatted to 2dp string
 * - active_count: stores where subscription_status === 'active'
 * - past_due_count: stores where subscription_status === 'past_due'
 * - cancelled_count: stores where subscription_status === 'cancelled'
 * - new_stores: stores whose created_at is within [periodFrom, periodTo] inclusive
 * - churned_stores: transitions where new_status === 'cancelled' within period
 * - revenue_by_plan: for each plan, sum monthly-normalized prices of active stores
 *   on that plan, formatted to 2dp
 * - All counts are non-negative integers; monetary values are 2dp strings
 * - Empty input → all zeros
 * - NEVER reads raw store data — only from the provided records (Control_Plane)
 *
 * Pure function for Property 31 testing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreRecord {
  id: string;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  subscription_plan_id: string | null;
  created_at: string; // ISO
}

export interface PlanRecord {
  id: string;
  name: string;
  price: number; // monthly or yearly price
  billing_interval: 'monthly' | 'yearly';
}

export interface StatusTransitionRecord {
  store_id: string;
  new_status: string;
  timestamp: string; // ISO
}

export interface AnalyticsResult {
  mrr: string; // monetary 2dp string e.g. "4950.00"
  active_count: number;
  past_due_count: number;
  cancelled_count: number;
  new_stores: number; // created within period
  churned_stores: number; // transitioned to cancelled within period
  revenue_by_plan: Array<{ plan_id: string; plan_name: string; revenue: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a number to a 2-decimal-place string (monetary).
 * Uses fixed-point representation; negative values are clamped to "0.00".
 */
function formatMoney(value: number): string {
  if (value < 0 || !isFinite(value)) {
    return '0.00';
  }
  return value.toFixed(2);
}

/**
 * Normalize a plan's price to monthly.
 * - monthly → price as-is
 * - yearly → price / 12
 */
function normalizeMonthly(plan: PlanRecord): number {
  if (plan.billing_interval === 'yearly') {
    return plan.price / 12;
  }
  return plan.price;
}

/**
 * Check whether a timestamp (ISO string) falls within [from, to] inclusive.
 * Comparison is done at date granularity (YYYY-MM-DD) to match the period endpoints.
 */
function isWithinPeriod(timestamp: string, periodFrom: string, periodTo: string): boolean {
  const tsDate = new Date(timestamp);
  if (isNaN(tsDate.getTime())) {
    return false;
  }

  // Normalize all to date strings for inclusive comparison
  const tsDateStr = tsDate.toISOString().slice(0, 10);
  const fromStr = periodFrom.slice(0, 10);
  const toStr = periodTo.slice(0, 10);

  return tsDateStr >= fromStr && tsDateStr <= toStr;
}

// ---------------------------------------------------------------------------
// Main aggregation function
// ---------------------------------------------------------------------------

/**
 * Compute platform analytics from Control_Plane records.
 *
 * All figures are derived only from the provided records — never from any
 * Store's raw domain data (R19.8). Returns zeros for empty inputs (R19.9).
 */
export function computeAnalytics(input: {
  stores: StoreRecord[];
  plans: PlanRecord[];
  transitions: StatusTransitionRecord[];
  periodFrom: string; // ISO date
  periodTo: string; // ISO date
}): AnalyticsResult {
  const { stores, plans, transitions, periodFrom, periodTo } = input;

  // Build a plan lookup map for O(1) access
  const planMap = new Map<string, PlanRecord>();
  for (const plan of plans) {
    planMap.set(plan.id, plan);
  }

  // --- Status counts (from current snapshot, not period-scoped) ---
  let activeCount = 0;
  let pastDueCount = 0;
  let cancelledCount = 0;

  for (const store of stores) {
    switch (store.subscription_status) {
      case 'active':
        activeCount++;
        break;
      case 'past_due':
        pastDueCount++;
        break;
      case 'cancelled':
        cancelledCount++;
        break;
    }
  }

  // --- MRR: sum of monthly-normalized prices for active stores ---
  let mrrTotal = 0;
  for (const store of stores) {
    if (store.subscription_status === 'active' && store.subscription_plan_id != null) {
      const plan = planMap.get(store.subscription_plan_id);
      if (plan) {
        mrrTotal += normalizeMonthly(plan);
      }
    }
  }

  // --- New stores: created_at within [periodFrom, periodTo] inclusive ---
  let newStores = 0;
  for (const store of stores) {
    if (isWithinPeriod(store.created_at, periodFrom, periodTo)) {
      newStores++;
    }
  }

  // --- Churned stores: transitions to 'cancelled' within period ---
  let churnedStores = 0;
  for (const transition of transitions) {
    if (
      transition.new_status === 'cancelled' &&
      isWithinPeriod(transition.timestamp, periodFrom, periodTo)
    ) {
      churnedStores++;
    }
  }

  // --- Revenue by plan: for each plan, sum monthly-normalized prices of active stores ---
  const revenueByPlanMap = new Map<string, number>();
  for (const store of stores) {
    if (store.subscription_status === 'active' && store.subscription_plan_id != null) {
      const plan = planMap.get(store.subscription_plan_id);
      if (plan) {
        const current = revenueByPlanMap.get(plan.id) ?? 0;
        revenueByPlanMap.set(plan.id, current + normalizeMonthly(plan));
      }
    }
  }

  // Build the revenue_by_plan array (only plans that have active stores)
  const revenueByPlan: AnalyticsResult['revenue_by_plan'] = [];
  for (const [planId, revenue] of revenueByPlanMap) {
    const plan = planMap.get(planId)!;
    revenueByPlan.push({
      plan_id: planId,
      plan_name: plan.name,
      revenue: formatMoney(revenue),
    });
  }

  return {
    mrr: formatMoney(mrrTotal),
    active_count: activeCount,
    past_due_count: pastDueCount,
    cancelled_count: cancelledCount,
    new_stores: newStores,
    churned_stores: churnedStores,
    revenue_by_plan: revenueByPlan,
  };
}
