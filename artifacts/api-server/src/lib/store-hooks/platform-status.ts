/**
 * Store-side platform-status self-gate — pure decision + status resolution.
 *
 * This module contains NO side effects (no DB, no HTTP, no I/O). It is intended
 * to be testable via Property 12 and Property 13 without a live environment.
 *
 * Feature: super-admin-platform
 * Requirements: 3.3, 3.4, 5.5
 */

import type { PlatformStatus } from '../platform/lifecycle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The kind of operation being attempted on the store side.
 */
export type OperationKind =
  | 'admin_read'
  | 'admin_write'
  | 'storefront_read'
  | 'order_submit';

/**
 * The result of the self-gate evaluation.
 */
export type GateDecision =
  | { allowed: true }
  | { allowed: false; httpStatus: 403 | 503; reason: string };

/**
 * Input for the status resolver — represents what the store knows when
 * deciding which PlatformStatus to use.
 */
export interface ResolveStatusInput {
  /** The last-known cached status (null if never fetched). */
  cachedStatus: PlatformStatus | null;
  /** Whether the cache TTL has expired. */
  cacheExpired: boolean;
  /** The result of attempting to fetch from the Control_Plane. */
  fetchResult: PlatformStatus | 'unreachable';
}

// ---------------------------------------------------------------------------
// Gate evaluation — pure decision
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an operation should be permitted given the store's current
 * platform status.
 *
 * Rules:
 *  - 'active' or 'onboarding' → always allowed
 *  - 'suspended' + 'admin_read' → allowed
 *  - 'suspended' + 'admin_write' → blocked (403)
 *  - 'suspended' + 'order_submit' → blocked (403)
 *  - 'suspended' + 'storefront_read' → blocked (503)
 *  - 'disabled' + anything → blocked (403)
 */
export function evaluateGate(
  status: PlatformStatus,
  operation: OperationKind,
): GateDecision {
  // Active / onboarding → permit everything
  if (status === 'active' || status === 'onboarding') {
    return { allowed: true };
  }

  // Disabled → deny all
  if (status === 'disabled') {
    return { allowed: false, httpStatus: 403, reason: 'Store is disabled' };
  }

  // Suspended — selective enforcement
  if (status === 'suspended') {
    switch (operation) {
      case 'admin_read':
        return { allowed: true };

      case 'admin_write':
        return {
          allowed: false,
          httpStatus: 403,
          reason: 'Store is suspended, write operations are blocked',
        };

      case 'order_submit':
        return {
          allowed: false,
          httpStatus: 403,
          reason: 'Store is suspended, new orders cannot be completed',
        };

      case 'storefront_read':
        return {
          allowed: false,
          httpStatus: 503,
          reason: 'Store is temporarily unavailable',
        };

      default: {
        const _exhaustive: never = operation;
        return { allowed: false, httpStatus: 403, reason: 'Store is suspended' };
      }
    }
  }

  // Fallback (should never be reached with typed input)
  const _exhaustive: never = status;
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Status resolver — pull-with-cache + fail-safe logic
// ---------------------------------------------------------------------------

/**
 * Resolve which PlatformStatus the store should use given:
 *  - The cached (last-known) status
 *  - Whether the cache has expired
 *  - The result of attempting to fetch from the Control_Plane
 *
 * Resolution rules:
 *  1. If fetchResult is a valid PlatformStatus → use it (fresh from Control_Plane)
 *  2. If fetchResult is 'unreachable' and cachedStatus is not null → use cachedStatus (stale but last-known)
 *  3. If fetchResult is 'unreachable' and cachedStatus is null → return 'active' (FAIL-SAFE)
 *
 * The fail-safe guarantees that a Control_Plane outage never blocks a paying Store.
 */
export function resolveStatus(input: ResolveStatusInput): PlatformStatus {
  const { cachedStatus, fetchResult } = input;

  // Fresh fetch succeeded — use the authoritative value
  if (fetchResult !== 'unreachable') {
    return fetchResult;
  }

  // Control_Plane unreachable — fall back to last-known
  if (cachedStatus != null) {
    return cachedStatus;
  }

  // No cache at all — fail-safe to 'active'
  return 'active';
}
