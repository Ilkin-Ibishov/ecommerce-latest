/**
 * Multi-channel notification delivery planning/outcome reducer — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.7, 18.8, 18.9, 18.10
 *
 * Responsibilities:
 * - Plan in-app + email delivery for multi-channel notification types
 * - Record each delivery attempt as succeeded | failed
 * - Apply saved per-type preference (except mandatory types)
 * - Retry failed email up to 3 more times, ≥60s apart
 * - Preserve in-app regardless of email outcome
 * - Handle missing/malformed owner email (no email attempt, error recorded)
 * - Billing/suspension types always use email channel
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Notification types that are always delivered via email regardless of preferences */
export const MANDATORY_EMAIL_TYPES = ['billing', 'suspension'] as const;
export type MandatoryEmailType = (typeof MANDATORY_EMAIL_TYPES)[number];

/** All notification types */
export type NotificationType =
  | 'billing'
  | 'suspension'
  | 'platform_update'
  | 'maintenance'
  | 'general';

/** Delivery channels */
export type DeliveryChannel = 'in_app' | 'email';

/** Outcome of a single delivery attempt */
export type DeliveryOutcome = 'succeeded' | 'failed';

/** A single delivery attempt record (R18.4) */
export interface DeliveryAttempt {
  channel: DeliveryChannel;
  outcome: DeliveryOutcome;
  attempted_at: string; // ISO 8601
  error?: string;
}

/** Per-type delivery preference for a store */
export interface DeliveryPreference {
  notification_type: NotificationType;
  email_enabled: boolean;
}

/** Input for planning delivery of a notification */
export interface DeliveryPlanInput {
  notificationId: string;
  notificationType: NotificationType;
  storeId: string;
  ownerEmail: string | null | undefined;
  preferences: DeliveryPreference[];
  isMultiChannel: boolean;
}

/** The planned channels and any immediate errors */
export interface DeliveryPlan {
  notificationId: string;
  storeId: string;
  channels: DeliveryChannel[];
  skipEmailReason?: string;
}

/** Input for recording the outcome of a delivery execution */
export interface DeliveryExecutionInput {
  plan: DeliveryPlan;
  emailOutcome: DeliveryOutcome | null; // null when email not attempted
  inAppOutcome: DeliveryOutcome;
  attemptedAt: string; // ISO 8601
  emailError?: string;
}

/** State tracking for retry logic */
export interface DeliveryState {
  notificationId: string;
  storeId: string;
  attempts: DeliveryAttempt[];
  inAppDelivered: boolean;
  emailDelivered: boolean;
  emailRetryCount: number;
  /** Maximum retries allowed for email (R18.9: up to 3 additional) */
  maxEmailRetries: number;
  skipEmailReason?: string;
}

/** Input for deciding whether a retry should occur */
export interface RetryDecisionInput {
  state: DeliveryState;
  now: string; // ISO 8601
}

/** Result of a retry decision */
export type RetryDecision =
  | { shouldRetry: true; reason: string }
  | { shouldRetry: false; reason: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum additional email attempts after first failure (R18.9) */
export const MAX_EMAIL_RETRIES = 3;

/** Minimum spacing between email attempts in milliseconds (R18.9: ≥60s) */
export const MIN_RETRY_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Pure helpers for Property 29 testing
// ---------------------------------------------------------------------------

/**
 * Plans which delivery channels a notification should be delivered on.
 *
 * - multichannel=true → plan both in-app + email (R18.1)
 * - multichannel=false → in-app only
 * - mandatory=true → ignore suppression preferences (R18.8)
 * - preferences with enabled=false suppress a channel UNLESS mandatory
 *
 * Always includes 'in_app'. Email added when multichannel AND
 * (mandatory OR email preference not suppressed).
 */
export function planDeliveryChannels(input: {
  multichannel: boolean;
  mandatory: boolean;
  preferences: { channel: string; enabled: boolean }[];
}): string[] {
  const channels: string[] = ['in_app'];

  if (!input.multichannel) {
    return channels;
  }

  // Check if email is suppressed by preferences
  const emailPref = input.preferences.find((p) => p.channel === 'email');
  const emailSuppressed = emailPref != null && !emailPref.enabled;

  // Mandatory types ignore suppression (R18.8)
  if (input.mandatory || !emailSuppressed) {
    channels.push('email');
  }

  return channels;
}

/**
 * Determines whether a failed email should be retried.
 *
 * - Max 3 retries (attempt 1 is the initial send, attempts 2–4 are retries)
 * - attemptNumber is 1-based: 1 = initial, 2 = first retry, 3 = second, 4 = third (last)
 * - Returns true if attemptNumber < maxRetries + 1 (i.e., more attempts remain)
 *
 * R18.9: up to 3 additional attempts after the first failure
 */
export function shouldRetryEmailSimple(input: {
  attemptNumber: number;
  maxRetries: number;
}): boolean {
  // attemptNumber must be at least 1 (initial attempt) and maxRetries >= 0
  if (input.attemptNumber < 1 || input.maxRetries < 0) return false;
  // The initial attempt is #1; retries are attempts 2..maxRetries+1
  // So we can retry if current attempt hasn't exhausted all retry slots
  return input.attemptNumber <= input.maxRetries;
}

/**
 * Records the outcome of a delivery attempt for a single channel.
 *
 * Maps a boolean success to the typed outcome string (R18.4).
 */
export function recordDeliveryOutcome(input: {
  channel: string;
  success: boolean;
}): { channel: string; outcome: 'succeeded' | 'failed' } {
  return {
    channel: input.channel,
    outcome: input.success ? 'succeeded' : 'failed',
  };
}

/**
 * Determines whether an email delivery can be attempted given the owner email.
 *
 * - null → no attempt, error recorded, in-app preserved (R18.10)
 * - malformed → no attempt, error recorded, in-app preserved (R18.10)
 * - valid → canAttempt: true
 */
export function canAttemptEmail(
  ownerEmail: string | null,
): { canAttempt: true } | { canAttempt: false; error: string } {
  if (ownerEmail == null) {
    return { canAttempt: false, error: 'Owner email is missing' };
  }

  const trimmed = ownerEmail.trim();
  if (trimmed.length === 0) {
    return { canAttempt: false, error: 'Owner email is empty' };
  }

  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { canAttempt: false, error: `Owner email is malformed: ${ownerEmail}` };
  }

  return { canAttempt: true };
}

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

/**
 * Validates an email address format. Returns true if the email is non-empty
 * and matches a basic email pattern. Returns false for missing/malformed (R18.10).
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (email == null) return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  // Basic email format: something@something.something
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// ---------------------------------------------------------------------------
// isMandatoryType — checks if a notification type requires email (R18.8)
// ---------------------------------------------------------------------------

export function isMandatoryType(type: NotificationType): boolean {
  return (MANDATORY_EMAIL_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// planDelivery — determines which channels to use (R18.1, 18.2, 18.3, 18.8, 18.10)
// ---------------------------------------------------------------------------

/**
 * Plans delivery channels for a notification.
 *
 * Rules:
 * 1. Multi-channel type → plan both in-app and email (R18.1)
 * 2. Billing/suspension types always use email (R18.2)
 * 3. Per-type preference suppresses email EXCEPT for mandatory types (R18.3, R18.8)
 * 4. Missing/malformed owner email → no email attempt, error recorded (R18.10)
 * 5. In-app is always included regardless (R18.7, R18.9)
 */
export function planDelivery(input: DeliveryPlanInput): DeliveryPlan {
  const {
    notificationId,
    notificationType,
    storeId,
    ownerEmail,
    preferences,
    isMultiChannel,
  } = input;

  const channels: DeliveryChannel[] = ['in_app'];

  // If not multi-channel, only in-app
  if (!isMultiChannel) {
    return { notificationId, storeId, channels };
  }

  // Determine if email should be included
  const mandatory = isMandatoryType(notificationType);

  // Check per-type preference (R18.3)
  const preference = preferences.find(
    (p) => p.notification_type === notificationType,
  );
  const emailSuppressedByPreference =
    preference != null && !preference.email_enabled;

  // Mandatory types ignore suppression preferences (R18.8)
  const emailWanted = mandatory || !emailSuppressedByPreference;

  if (!emailWanted) {
    return { notificationId, storeId, channels };
  }

  // Validate owner email (R18.10)
  if (!isValidEmail(ownerEmail)) {
    return {
      notificationId,
      storeId,
      channels, // in-app only — email skipped
      skipEmailReason: ownerEmail == null
        ? 'Owner email is missing'
        : `Owner email is malformed: ${ownerEmail}`,
    };
  }

  // Email is planned
  channels.push('email');
  return { notificationId, storeId, channels };
}

// ---------------------------------------------------------------------------
// createInitialState — creates the initial delivery state from a plan
// ---------------------------------------------------------------------------

export function createInitialState(plan: DeliveryPlan): DeliveryState {
  return {
    notificationId: plan.notificationId,
    storeId: plan.storeId,
    attempts: [],
    inAppDelivered: false,
    emailDelivered: false,
    emailRetryCount: 0,
    maxEmailRetries: MAX_EMAIL_RETRIES,
    skipEmailReason: plan.skipEmailReason,
  };
}

// ---------------------------------------------------------------------------
// recordAttempt — records the outcome of a delivery attempt (R18.4)
// ---------------------------------------------------------------------------

/**
 * Records a delivery attempt outcome and returns the updated state.
 * In-app is preserved regardless of email outcome (R18.7, R18.9).
 */
export function recordAttempt(
  state: DeliveryState,
  attempt: DeliveryAttempt,
): DeliveryState {
  const newState: DeliveryState = {
    ...state,
    attempts: [...state.attempts, attempt],
  };

  if (attempt.channel === 'in_app' && attempt.outcome === 'succeeded') {
    newState.inAppDelivered = true;
  }

  if (attempt.channel === 'email') {
    if (attempt.outcome === 'succeeded') {
      newState.emailDelivered = true;
    } else {
      // Failed email attempt counts toward retry limit
      newState.emailRetryCount = state.emailRetryCount + 1;
    }
  }

  return newState;
}

// ---------------------------------------------------------------------------
// shouldRetryEmail — decides if another email attempt should be made (R18.9)
// ---------------------------------------------------------------------------

/**
 * Determines whether a failed email should be retried.
 *
 * Rules:
 * - Up to 3 additional attempts after the first failure (R18.9)
 * - At least 60 seconds between attempts (R18.9)
 * - Never retry if already delivered
 * - Never retry if email was skipped (missing/malformed email)
 */
export function shouldRetryEmail(input: RetryDecisionInput): RetryDecision {
  const { state, now } = input;

  // Already delivered — no retry needed
  if (state.emailDelivered) {
    return { shouldRetry: false, reason: 'Email already delivered' };
  }

  // Email was skipped due to missing/malformed address
  if (state.skipEmailReason != null) {
    return { shouldRetry: false, reason: state.skipEmailReason };
  }

  // Check retry count (initial attempt + up to 3 retries = 4 total attempts)
  // emailRetryCount tracks failed attempts; first failure = 1, max = MAX_EMAIL_RETRIES + 1
  // After the initial send, up to 3 MORE = emailRetryCount <= MAX_EMAIL_RETRIES
  if (state.emailRetryCount > MAX_EMAIL_RETRIES) {
    return {
      shouldRetry: false,
      reason: `Maximum retries exhausted (${MAX_EMAIL_RETRIES} additional attempts made)`,
    };
  }

  // No failed attempts yet — nothing to retry
  if (state.emailRetryCount === 0) {
    return { shouldRetry: false, reason: 'No failed attempt to retry' };
  }

  // Check minimum interval since last email attempt
  const emailAttempts = state.attempts.filter((a) => a.channel === 'email');
  const lastEmailAttempt = emailAttempts[emailAttempts.length - 1];
  if (lastEmailAttempt) {
    const lastAttemptTime = new Date(lastEmailAttempt.attempted_at).getTime();
    const nowTime = new Date(now).getTime();
    const elapsed = nowTime - lastAttemptTime;

    if (elapsed < MIN_RETRY_INTERVAL_MS) {
      return {
        shouldRetry: false,
        reason: `Minimum retry interval not reached (${Math.ceil((MIN_RETRY_INTERVAL_MS - elapsed) / 1000)}s remaining)`,
      };
    }
  }

  return { shouldRetry: true, reason: 'Retry conditions met' };
}

// ---------------------------------------------------------------------------
// getDeliverySummary — summarizes the final delivery outcome
// ---------------------------------------------------------------------------

export interface DeliverySummary {
  notificationId: string;
  storeId: string;
  inAppDelivered: boolean;
  emailDelivered: boolean;
  emailSkipped: boolean;
  skipEmailReason?: string;
  totalAttempts: number;
  emailAttempts: number;
  lastEmailError?: string;
}

/**
 * Returns a summary of the delivery state for reporting/persistence.
 */
export function getDeliverySummary(state: DeliveryState): DeliverySummary {
  const emailAttempts = state.attempts.filter((a) => a.channel === 'email');
  const lastFailedEmail = [...emailAttempts]
    .reverse()
    .find((a) => a.outcome === 'failed');

  return {
    notificationId: state.notificationId,
    storeId: state.storeId,
    inAppDelivered: state.inAppDelivered,
    emailDelivered: state.emailDelivered,
    emailSkipped: state.skipEmailReason != null,
    skipEmailReason: state.skipEmailReason,
    totalAttempts: state.attempts.length,
    emailAttempts: emailAttempts.length,
    lastEmailError: lastFailedEmail?.error,
  };
}
