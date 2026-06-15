/**
 * Platform_Status finite-state machine — pure functions for store lifecycle.
 *
 * Feature: super-admin-platform
 * Requirements: 3.1, 3.2, 3.8, 3.9, 3.10, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlatformStatus = 'onboarding' | 'active' | 'suspended' | 'disabled';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';

export type PlatformAction = 'activate' | 'suspend' | 'reactivate' | 'disable';

export type TransitionSuccess = { success: true; newStatus: PlatformStatus };
export type TransitionFailure = {
  success: false;
  reason: 'illegal_transition' | 'already_in_state';
};
export type TransitionResult = TransitionSuccess | TransitionFailure;

// ---------------------------------------------------------------------------
// FSM transition table
// ---------------------------------------------------------------------------

/**
 * Transition the Platform_Status given an action.
 *
 * Rules:
 *  - activate: only from 'onboarding' → 'active'; else illegal
 *  - suspend:  from 'active' → 'suspended'; from 'suspended' → already_in_state (idempotent); else illegal
 *  - reactivate: from 'suspended' → 'active'; from 'active' → already_in_state (idempotent); else illegal
 *  - disable: from 'active' or 'suspended' → 'disabled'; from 'disabled' → already_in_state; else illegal
 */
export function transitionPlatformStatus(
  current: PlatformStatus,
  action: PlatformAction,
): TransitionResult {
  switch (action) {
    case 'activate': {
      if (current === 'onboarding') {
        return { success: true, newStatus: 'active' };
      }
      return { success: false, reason: 'illegal_transition' };
    }

    case 'suspend': {
      if (current === 'active') {
        return { success: true, newStatus: 'suspended' };
      }
      if (current === 'suspended') {
        return { success: false, reason: 'already_in_state' };
      }
      return { success: false, reason: 'illegal_transition' };
    }

    case 'reactivate': {
      if (current === 'suspended') {
        return { success: true, newStatus: 'active' };
      }
      if (current === 'active') {
        return { success: false, reason: 'already_in_state' };
      }
      return { success: false, reason: 'illegal_transition' };
    }

    case 'disable': {
      if (current === 'active' || current === 'suspended') {
        return { success: true, newStatus: 'disabled' };
      }
      if (current === 'disabled') {
        return { success: false, reason: 'already_in_state' };
      }
      // From 'onboarding' → illegal (strict)
      return { success: false, reason: 'illegal_transition' };
    }

    default: {
      // Exhaustive check — should never happen with typed input
      const _exhaustive: never = action;
      return { success: false, reason: 'illegal_transition' };
    }
  }
}

// ---------------------------------------------------------------------------
// Store creation defaults
// ---------------------------------------------------------------------------

/**
 * Returns the default status values for a newly-created Store.
 * New stores always start as 'onboarding' + 'trialing'.
 */
export function createStoreDefaults(): {
  platformStatus: 'onboarding';
  subscriptionStatus: 'trialing';
} {
  return {
    platformStatus: 'onboarding',
    subscriptionStatus: 'trialing',
  };
}

// ---------------------------------------------------------------------------
// Name collision check
// ---------------------------------------------------------------------------

/**
 * Case-insensitive name collision check.
 * Returns `true` if `newName` collides with any name in `existingNames`.
 */
export function checkNameCollision(
  newName: string,
  existingNames: string[],
): boolean {
  const normalized = newName.toLowerCase();
  return existingNames.some((name) => name.toLowerCase() === normalized);
}
