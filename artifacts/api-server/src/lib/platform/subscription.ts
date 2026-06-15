/**
 * Subscription-status filter and update validation — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 6.3, 6.5, 6.6, 6.7, 6.8, 6.9
 *
 * Logic:
 * - filterBySubscriptionStatus: Returns only the stores whose subscription_status
 *   exactly equals the given status value. Empty array when none match.
 * - validateSubscriptionStatusUpdate: Validates a subscription-status update request.
 *   Returns a discriminated union: valid (new status persisted) or invalid (400, status unchanged).
 *   Pure — no DB, no side effects. Atomicity (R6.9) is enforced at the route level.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscriptionStatusValue =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled";

export const VALID_SUBSCRIPTION_STATUSES: readonly SubscriptionStatusValue[] = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
];

export type SubscriptionUpdateResult =
  | { valid: true; newStatus: SubscriptionStatusValue }
  | { valid: false; httpStatus: 400; error: string };

// ---------------------------------------------------------------------------
// Filter function
// ---------------------------------------------------------------------------

/**
 * Filter stores by their subscription_status.
 *
 * @param stores - Array of store-like objects with at least a `subscription_status` field
 * @param status - The subscription_status value to match (exact equality)
 * @returns A new array containing only the stores whose subscription_status
 *          exactly equals the given status. Returns an empty array when none match.
 */
export function filterBySubscriptionStatus<
  T extends { subscription_status: string; [key: string]: unknown },
>(stores: T[], status: string): T[] {
  return stores.filter((store) => store.subscription_status === status);
}

// ---------------------------------------------------------------------------
// Update validation (R6.3, R6.8, R6.9)
// ---------------------------------------------------------------------------

/**
 * Validate a subscription-status update request.
 *
 * This is a pure reducer: it inspects the inputs and returns either a valid
 * result (new status ready to persist) or an invalid result (HTTP 400, existing
 * status unchanged). The function never performs side effects — the calling
 * route is responsible for persisting or returning the error atomically (R6.9).
 *
 * Logic:
 * 1. If storeExists is false → 400, "Store identifier is missing or invalid"
 * 2. If newStatus is not in VALID_SUBSCRIPTION_STATUSES → 400, "Subscription status must be one of: trialing, active, past_due, cancelled"
 * 3. Otherwise → valid, newStatus cast to SubscriptionStatusValue
 */
export function validateSubscriptionStatusUpdate(input: {
  newStatus: string;
  storeExists: boolean;
}): SubscriptionUpdateResult {
  if (!input.storeExists) {
    return {
      valid: false,
      httpStatus: 400,
      error: "Store identifier is missing or invalid",
    };
  }

  if (
    !(VALID_SUBSCRIPTION_STATUSES as readonly string[]).includes(
      input.newStatus,
    )
  ) {
    return {
      valid: false,
      httpStatus: 400,
      error:
        "Subscription status must be one of: trialing, active, past_due, cancelled",
    };
  }

  return {
    valid: true,
    newStatus: input.newStatus as SubscriptionStatusValue,
  };
}
