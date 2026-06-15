/**
 * Pure billing lifecycle transition reducer.
 *
 * Feature: super-admin-platform
 * Requirements: 6.10, 14.2, 14.3, 14.5, 14.6, 14.7, 14.10
 *
 * Drives subscription_status and platform_status transitions based on
 * billing events (invoice due passed, grace period ended, payment recorded).
 * Manual mark-paid drives the same transitions as automated payment.
 */

export type BillingEvent =
  | { type: 'invoice_due_passed'; invoiceId: string }
  | { type: 'grace_period_ended'; invoiceId: string }
  | { type: 'payment_recorded'; invoiceId: string };

export interface BillingState {
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'cancelled';
  platformStatus: 'onboarding' | 'active' | 'suspended' | 'disabled';
  gracePeriodActive: boolean;
}

export interface BillingTransition {
  newSubscriptionStatus: BillingState['subscriptionStatus'];
  newPlatformStatus: BillingState['platformStatus'];
  endGracePeriod: boolean;
  action: string; // description for audit
}

/**
 * Applies a billing event to the current state and returns the resulting transition,
 * or null if no transition is needed.
 *
 * Transition rules:
 * - `invoice_due_passed`:
 *   → subscriptionStatus becomes 'past_due', start grace period
 *   (only if not already past_due — idempotent)
 *
 * - `grace_period_ended`:
 *   → platformStatus becomes 'suspended' (only if subscriptionStatus is still past_due)
 *   No change if already resolved (payment came in during grace)
 *
 * - `payment_recorded`:
 *   - if subscriptionStatus is 'past_due' → subscriptionStatus='active', end grace period
 *   - if platformStatus is 'suspended' (non-payment) → platformStatus='active', end grace period
 *   - if already 'active' and not suspended → return null (no change needed)
 *
 * Returns null when no transition is needed.
 */
export function applyBillingEvent(
  state: BillingState,
  event: BillingEvent
): BillingTransition | null {
  switch (event.type) {
    case 'invoice_due_passed': {
      // Only transition if not already past_due or cancelled
      if (
        state.subscriptionStatus === 'past_due' ||
        state.subscriptionStatus === 'cancelled'
      ) {
        return null;
      }

      return {
        newSubscriptionStatus: 'past_due',
        newPlatformStatus: state.platformStatus,
        endGracePeriod: false,
        action: `invoice_due_passed: subscription_status → past_due, grace period started (invoice: ${event.invoiceId})`,
      };
    }

    case 'grace_period_ended': {
      // Only suspend if still past_due (payment hasn't come in during grace)
      if (state.subscriptionStatus !== 'past_due') {
        return null;
      }

      // Only suspend if platform isn't already suspended or disabled
      if (
        state.platformStatus === 'suspended' ||
        state.platformStatus === 'disabled'
      ) {
        return null;
      }

      return {
        newSubscriptionStatus: 'past_due',
        newPlatformStatus: 'suspended',
        endGracePeriod: true,
        action: `grace_period_ended: platform_status → suspended (invoice: ${event.invoiceId})`,
      };
    }

    case 'payment_recorded': {
      const isPastDue = state.subscriptionStatus === 'past_due';
      const isSuspended = state.platformStatus === 'suspended';

      // If already active and not suspended, no change needed
      if (!isPastDue && !isSuspended) {
        return null;
      }

      // Payment resolves past_due → active and/or suspended → active
      const newSubscriptionStatus: BillingState['subscriptionStatus'] = isPastDue
        ? 'active'
        : state.subscriptionStatus;

      const newPlatformStatus: BillingState['platformStatus'] = isSuspended
        ? 'active'
        : state.platformStatus;

      // Determine the action description
      const actions: string[] = [];
      if (isPastDue) {
        actions.push('subscription_status → active');
      }
      if (isSuspended) {
        actions.push('platform_status → active (reactivated after non-payment suspension)');
      }
      if (state.gracePeriodActive) {
        actions.push('grace period ended');
      }

      return {
        newSubscriptionStatus,
        newPlatformStatus,
        endGracePeriod: isPastDue || isSuspended,
        action: `payment_recorded: ${actions.join(', ')} (invoice: ${event.invoiceId})`,
      };
    }

    default:
      return null;
  }
}
