/**
 * Store-side plan-based quota enforcement — pure functions (no DB, no HTTP, no I/O).
 *
 * The Control_Plane records each plan's quota limits. The Store enforces them
 * locally against its own data. This module provides the pure decision logic
 * for claim/release operations and usage queries.
 *
 * Feature: super-admin-platform
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.11, 15.12
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimQuotaInput {
  currentUsage: number;
  limit: number;
  requested: number;
}

export type ClaimQuotaResult =
  | { allowed: true; newUsage: number }
  | { allowed: false; httpStatus: 403; error: string };

export interface ReleaseQuotaInput {
  currentUsage: number;
  released: number;
}

export interface ReleaseQuotaResult {
  newUsage: number;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Derive the effective quota limit for a resource from a plan's quota_limits.
 *
 * - If planQuotaLimits is null/undefined (no plan assigned), returns 0 for every resource (R15.11).
 * - If the resource is not defined in the plan, returns 0 (no allocation = no creates allowed).
 * - Otherwise returns the plan's limit as a non-negative integer (clamped to 0 if somehow negative).
 *
 * Property 25, Property 26
 * Validates: Requirements 15.1, 15.2, 15.11
 */
export function getEffectiveLimit(
  planQuotaLimits: Record<string, number> | null,
  resource: string,
): number {
  if (planQuotaLimits == null) {
    return 0;
  }
  const raw = planQuotaLimits[resource];
  if (raw == null || typeof raw !== 'number' || isNaN(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

/**
 * Attempt to claim (create) quota-bounded resources.
 *
 * Rules (R15.3, R15.4, R15.9, R15.11, R15.12):
 *  - If currentUsage + requested <= limit → allowed, newUsage = currentUsage + requested
 *  - If currentUsage + requested > limit → rejected with 403
 *  - If limit is 0 (no plan or resource not in plan) → always rejected
 *
 * The caller must ensure atomicity externally (e.g., via DB transaction or CAS)
 * to satisfy R15.12 (concurrent claims never exceed limit).
 *
 * Property 25
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.9, 15.11, 15.12
 */
export function claimQuota(input: ClaimQuotaInput): ClaimQuotaResult {
  const currentUsage = Math.max(0, Math.floor(input.currentUsage));
  const limit = Math.max(0, Math.floor(input.limit));
  const requested = Math.max(1, Math.floor(input.requested));

  // Check if usage is already at or above limit (R15.9)
  if (currentUsage >= limit) {
    return {
      allowed: false,
      httpStatus: 403,
      error: `Quota exceeded: current usage ${currentUsage} is at or above limit ${limit}`,
    };
  }

  // Check if the claim would exceed the limit (R15.4, R15.12)
  if (currentUsage + requested > limit) {
    return {
      allowed: false,
      httpStatus: 403,
      error: `Quota exceeded: requesting ${requested} would bring usage from ${currentUsage} to ${currentUsage + requested}, exceeding limit ${limit}`,
    };
  }

  // Permitted — return new usage (R15.3)
  return {
    allowed: true,
    newUsage: currentUsage + requested,
  };
}

/**
 * Release (delete) quota-bounded resources, decrementing usage.
 *
 * Decrements usage, floored at 0 — usage can never go negative.
 *
 * Property 25
 * Validates: Requirements 15.3, 15.9
 */
export function releaseQuota(input: ReleaseQuotaInput): ReleaseQuotaResult {
  const currentUsage = Math.max(0, Math.floor(input.currentUsage));
  const released = Math.max(0, Math.floor(input.released));
  const newUsage = Math.max(0, currentUsage - released);
  return { newUsage };
}

/**
 * Start a new quota window (for time-windowed resources like orders_monthly).
 *
 * Returns 0 — a new period always starts at zero usage regardless of prior periods.
 *
 * Property 25
 */
export function startNewWindow(): number {
  return 0;
}

/**
 * Check whether a read operation is blocked by quota.
 *
 * Reads are NEVER blocked by any quota (R15.5). This function always returns
 * false regardless of usage or limit values.
 *
 * Property 26
 * Validates: Requirements 15.5
 */
export function isReadBlocked(
  _currentUsage: number,
  _limit: number,
): false {
  return false;
}

/**
 * Query quota usage for a specific resource.
 *
 * Returns both the limit and current usage as non-negative integers (R15.6).
 * If the effective limit has been lowered below current usage, the usage is
 * still reported truthfully — the data is retained (R15.8), only further
 * creates are blocked.
 *
 * Property 26
 * Validates: Requirements 15.6, 15.7
 */
export function queryQuotaUsage(
  currentUsage: number,
  effectiveLimit: number,
): { limit: number; usage: number } {
  return {
    limit: Math.max(0, Math.floor(effectiveLimit)),
    usage: Math.max(0, Math.floor(currentUsage)),
  };
}

/**
 * Determine whether lowering a limit below current usage causes data deletion.
 *
 * It never does (R15.8). Data is always retained; only further creates are blocked.
 *
 * Property 26
 * Validates: Requirements 15.4, 15.8
 */
export function assessLimitReduction(
  currentUsage: number,
  newLimit: number,
): { dataRetained: true; createsBlocked: boolean } {
  const usage = Math.max(0, Math.floor(currentUsage));
  const limit = Math.max(0, Math.floor(newLimit));
  return {
    dataRetained: true,
    createsBlocked: usage >= limit,
  };
}

/**
 * Simulate concurrent claims against a shared usage counter.
 *
 * Given a starting usage and N concurrent claim attempts of size 1 each,
 * returns how many are granted and the final usage — ensuring the total
 * granted never exceeds the limit (R15.12).
 *
 * This represents the logical invariant that the Store must enforce atomically
 * (e.g., via serialized DB transactions or atomic compare-and-swap).
 *
 * Property 25
 * Validates: Requirements 15.12
 */
export function simulateConcurrentClaims(
  startingUsage: number,
  effectiveLimit: number,
  claimCount: number,
): { granted: number; rejected: number; finalUsage: number } {
  const usage = Math.max(0, Math.floor(startingUsage));
  const limit = Math.max(0, Math.floor(effectiveLimit));
  const attempts = Math.max(0, Math.floor(claimCount));

  const available = Math.max(0, limit - usage);
  const granted = Math.min(attempts, available);
  const rejected = attempts - granted;
  const finalUsage = usage + granted;

  return { granted, rejected, finalUsage };
}
