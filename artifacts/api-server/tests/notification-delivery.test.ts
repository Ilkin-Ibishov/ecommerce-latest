import { describe, it, expect } from 'vitest';
import {
  planDeliveryChannels,
  shouldRetryEmailSimple,
  recordDeliveryOutcome,
  canAttemptEmail,
  planDelivery,
  shouldRetryEmail,
  recordAttempt,
  createInitialState,
  isValidEmail,
  isMandatoryType,
  MAX_EMAIL_RETRIES,
  MIN_RETRY_INTERVAL_MS,
  type DeliveryPlanInput,
  type DeliveryState,
  type DeliveryAttempt,
} from '../src/lib/notifications/delivery';

// Feature: super-admin-platform
// Requirements: 18.1, 18.2, 18.3, 18.4, 18.7, 18.8, 18.9, 18.10

// ---------------------------------------------------------------------------
// planDeliveryChannels — simplified pure function for Property 29
// ---------------------------------------------------------------------------

describe('planDeliveryChannels', () => {
  it('returns only in_app when multichannel is false (R18.1)', () => {
    const result = planDeliveryChannels({
      multichannel: false,
      mandatory: false,
      preferences: [],
    });
    expect(result).toEqual(['in_app']);
  });

  it('returns in_app + email when multichannel is true and no suppression (R18.1)', () => {
    const result = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: [],
    });
    expect(result).toEqual(['in_app', 'email']);
  });

  it('suppresses email when preference disables it (R18.3)', () => {
    const result = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: [{ channel: 'email', enabled: false }],
    });
    expect(result).toEqual(['in_app']);
  });

  it('mandatory ignores email suppression preference (R18.8)', () => {
    const result = planDeliveryChannels({
      multichannel: true,
      mandatory: true,
      preferences: [{ channel: 'email', enabled: false }],
    });
    expect(result).toEqual(['in_app', 'email']);
  });

  it('always includes in_app even when email is enabled (R18.7)', () => {
    const result = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: [{ channel: 'email', enabled: true }],
    });
    expect(result).toContain('in_app');
    expect(result).toContain('email');
  });

  it('returns only in_app when multichannel=false even if mandatory=true', () => {
    const result = planDeliveryChannels({
      multichannel: false,
      mandatory: true,
      preferences: [],
    });
    expect(result).toEqual(['in_app']);
  });

  it('preferences for non-email channels do not affect email inclusion', () => {
    const result = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: [{ channel: 'sms', enabled: false }],
    });
    expect(result).toEqual(['in_app', 'email']);
  });
});

// ---------------------------------------------------------------------------
// shouldRetryEmailSimple — simplified retry decision for Property 29
// ---------------------------------------------------------------------------

describe('shouldRetryEmailSimple', () => {
  it('returns true when attemptNumber <= maxRetries (more attempts available)', () => {
    expect(shouldRetryEmailSimple({ attemptNumber: 1, maxRetries: 3 })).toBe(true);
    expect(shouldRetryEmailSimple({ attemptNumber: 2, maxRetries: 3 })).toBe(true);
    expect(shouldRetryEmailSimple({ attemptNumber: 3, maxRetries: 3 })).toBe(true);
  });

  it('returns false when attemptNumber > maxRetries (exhausted) (R18.9)', () => {
    expect(shouldRetryEmailSimple({ attemptNumber: 4, maxRetries: 3 })).toBe(false);
    expect(shouldRetryEmailSimple({ attemptNumber: 5, maxRetries: 3 })).toBe(false);
  });

  it('returns false when maxRetries is 0 and attemptNumber is 1', () => {
    expect(shouldRetryEmailSimple({ attemptNumber: 1, maxRetries: 0 })).toBe(false);
  });

  it('returns false for invalid attemptNumber < 1', () => {
    expect(shouldRetryEmailSimple({ attemptNumber: 0, maxRetries: 3 })).toBe(false);
    expect(shouldRetryEmailSimple({ attemptNumber: -1, maxRetries: 3 })).toBe(false);
  });

  it('returns false for invalid maxRetries < 0', () => {
    expect(shouldRetryEmailSimple({ attemptNumber: 1, maxRetries: -1 })).toBe(false);
  });

  it('max 3 retries means attempts 1–3 can retry, attempt 4 cannot (R18.9)', () => {
    // With maxRetries=3: attempts 1, 2, 3 can retry; attempt 4 cannot
    expect(shouldRetryEmailSimple({ attemptNumber: 1, maxRetries: 3 })).toBe(true);
    expect(shouldRetryEmailSimple({ attemptNumber: 2, maxRetries: 3 })).toBe(true);
    expect(shouldRetryEmailSimple({ attemptNumber: 3, maxRetries: 3 })).toBe(true);
    expect(shouldRetryEmailSimple({ attemptNumber: 4, maxRetries: 3 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordDeliveryOutcome — maps boolean success to typed outcome (R18.4)
// ---------------------------------------------------------------------------

describe('recordDeliveryOutcome', () => {
  it('maps success=true to "succeeded" (R18.4)', () => {
    const result = recordDeliveryOutcome({ channel: 'email', success: true });
    expect(result).toEqual({ channel: 'email', outcome: 'succeeded' });
  });

  it('maps success=false to "failed" (R18.4)', () => {
    const result = recordDeliveryOutcome({ channel: 'email', success: false });
    expect(result).toEqual({ channel: 'email', outcome: 'failed' });
  });

  it('works for in_app channel', () => {
    const result = recordDeliveryOutcome({ channel: 'in_app', success: true });
    expect(result).toEqual({ channel: 'in_app', outcome: 'succeeded' });
  });

  it('preserves the channel name as-is', () => {
    const result = recordDeliveryOutcome({ channel: 'sms', success: false });
    expect(result).toEqual({ channel: 'sms', outcome: 'failed' });
  });

  it('outcome is always exactly "succeeded" or "failed"', () => {
    const success = recordDeliveryOutcome({ channel: 'email', success: true });
    const failure = recordDeliveryOutcome({ channel: 'email', success: false });
    expect(['succeeded', 'failed']).toContain(success.outcome);
    expect(['succeeded', 'failed']).toContain(failure.outcome);
  });
});

// ---------------------------------------------------------------------------
// canAttemptEmail — validates owner email for delivery (R18.10)
// ---------------------------------------------------------------------------

describe('canAttemptEmail', () => {
  it('returns canAttempt: false with error when email is null (R18.10)', () => {
    const result = canAttemptEmail(null);
    expect(result.canAttempt).toBe(false);
    if (!result.canAttempt) {
      expect(result.error).toBe('Owner email is missing');
    }
  });

  it('returns canAttempt: false with error when email is empty string (R18.10)', () => {
    const result = canAttemptEmail('');
    expect(result.canAttempt).toBe(false);
    if (!result.canAttempt) {
      expect(result.error).toBe('Owner email is empty');
    }
  });

  it('returns canAttempt: false with error when email is whitespace only (R18.10)', () => {
    const result = canAttemptEmail('   ');
    expect(result.canAttempt).toBe(false);
    if (!result.canAttempt) {
      expect(result.error).toBe('Owner email is empty');
    }
  });

  it('returns canAttempt: false with error for malformed email (R18.10)', () => {
    const result = canAttemptEmail('not-an-email');
    expect(result.canAttempt).toBe(false);
    if (!result.canAttempt) {
      expect(result.error).toContain('malformed');
    }
  });

  it('returns canAttempt: false for email without @ sign', () => {
    const result = canAttemptEmail('userdomain.com');
    expect(result.canAttempt).toBe(false);
  });

  it('returns canAttempt: false for email without domain part', () => {
    const result = canAttemptEmail('user@');
    expect(result.canAttempt).toBe(false);
  });

  it('returns canAttempt: true for valid email', () => {
    const result = canAttemptEmail('owner@store.com');
    expect(result).toEqual({ canAttempt: true });
  });

  it('returns canAttempt: true for valid email with subdomain', () => {
    const result = canAttemptEmail('admin@mail.store.co.uk');
    expect(result).toEqual({ canAttempt: true });
  });

  it('returns canAttempt: true for email with plus addressing', () => {
    const result = canAttemptEmail('owner+tag@store.com');
    expect(result).toEqual({ canAttempt: true });
  });
});

// ---------------------------------------------------------------------------
// Integration between simplified functions — delivery flow scenarios
// ---------------------------------------------------------------------------

describe('delivery flow scenarios', () => {
  it('billing notification uses email even when suppressed (R18.2, R18.8)', () => {
    // Plan channels with mandatory=true (billing type)
    const channels = planDeliveryChannels({
      multichannel: true,
      mandatory: true,
      preferences: [{ channel: 'email', enabled: false }],
    });
    expect(channels).toContain('email');

    // Verify email can be attempted
    const emailCheck = canAttemptEmail('billing@store.com');
    expect(emailCheck.canAttempt).toBe(true);

    // Record successful delivery
    const outcome = recordDeliveryOutcome({ channel: 'email', success: true });
    expect(outcome.outcome).toBe('succeeded');
  });

  it('missing email prevents email attempt but preserves in-app (R18.10, R18.7)', () => {
    const channels = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: [],
    });
    expect(channels).toContain('email');

    // But canAttemptEmail blocks it
    const emailCheck = canAttemptEmail(null);
    expect(emailCheck.canAttempt).toBe(false);

    // In-app is still delivered successfully
    const inAppOutcome = recordDeliveryOutcome({ channel: 'in_app', success: true });
    expect(inAppOutcome.outcome).toBe('succeeded');
  });

  it('failed email retries up to 3 times then stops (R18.9)', () => {
    // First attempt fails
    expect(shouldRetryEmailSimple({ attemptNumber: 1, maxRetries: 3 })).toBe(true);
    // Second attempt fails
    expect(shouldRetryEmailSimple({ attemptNumber: 2, maxRetries: 3 })).toBe(true);
    // Third attempt fails
    expect(shouldRetryEmailSimple({ attemptNumber: 3, maxRetries: 3 })).toBe(true);
    // Fourth attempt — no more retries
    expect(shouldRetryEmailSimple({ attemptNumber: 4, maxRetries: 3 })).toBe(false);
  });

  it('email preference suppression only applies to non-mandatory types (R18.3, R18.8)', () => {
    const suppressedPrefs = [{ channel: 'email', enabled: false }];

    // Non-mandatory: suppressed
    const nonMandatory = planDeliveryChannels({
      multichannel: true,
      mandatory: false,
      preferences: suppressedPrefs,
    });
    expect(nonMandatory).not.toContain('email');

    // Mandatory: not suppressed
    const mandatory = planDeliveryChannels({
      multichannel: true,
      mandatory: true,
      preferences: suppressedPrefs,
    });
    expect(mandatory).toContain('email');
  });
});

// ---------------------------------------------------------------------------
// Existing comprehensive delivery functions — additional coverage
// ---------------------------------------------------------------------------

describe('planDelivery (comprehensive)', () => {
  it('plans in-app only for non-multichannel notifications', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'general',
      storeId: 's1',
      ownerEmail: 'test@example.com',
      preferences: [],
      isMultiChannel: false,
    });
    expect(plan.channels).toEqual(['in_app']);
    expect(plan.skipEmailReason).toBeUndefined();
  });

  it('plans in-app + email for multichannel with valid email', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'general',
      storeId: 's1',
      ownerEmail: 'test@example.com',
      preferences: [],
      isMultiChannel: true,
    });
    expect(plan.channels).toEqual(['in_app', 'email']);
  });

  it('skips email with reason when owner email is null (R18.10)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: null,
      preferences: [],
      isMultiChannel: true,
    });
    expect(plan.channels).toEqual(['in_app']);
    expect(plan.skipEmailReason).toBe('Owner email is missing');
  });

  it('skips email with reason when owner email is malformed (R18.10)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: 'bad-email',
      preferences: [],
      isMultiChannel: true,
    });
    expect(plan.channels).toEqual(['in_app']);
    expect(plan.skipEmailReason).toContain('malformed');
  });

  it('billing type ignores email suppression preference (R18.8)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [{ notification_type: 'billing', email_enabled: false }],
      isMultiChannel: true,
    });
    expect(plan.channels).toContain('email');
  });

  it('suspension type ignores email suppression preference (R18.8)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'suspension',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [{ notification_type: 'suspension', email_enabled: false }],
      isMultiChannel: true,
    });
    expect(plan.channels).toContain('email');
  });

  it('non-mandatory type respects email suppression (R18.3)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'general',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [{ notification_type: 'general', email_enabled: false }],
      isMultiChannel: true,
    });
    expect(plan.channels).toEqual(['in_app']);
  });
});

describe('recordAttempt + shouldRetryEmail (comprehensive)', () => {
  it('tracks email retry count on failure', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [],
      isMultiChannel: true,
    });

    let state = createInitialState(plan);

    // Record first email failure
    state = recordAttempt(state, {
      channel: 'email',
      outcome: 'failed',
      attempted_at: '2024-01-01T10:00:00Z',
      error: 'SMTP timeout',
    });
    expect(state.emailRetryCount).toBe(1);
    expect(state.emailDelivered).toBe(false);

    // Should retry after interval
    const decision = shouldRetryEmail({
      state,
      now: '2024-01-01T10:02:00Z', // 2 min later
    });
    expect(decision.shouldRetry).toBe(true);
  });

  it('stops retrying after MAX_EMAIL_RETRIES failures (R18.9)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [],
      isMultiChannel: true,
    });

    let state = createInitialState(plan);

    // Simulate MAX_EMAIL_RETRIES + 1 failures (exceeds max)
    for (let i = 0; i <= MAX_EMAIL_RETRIES; i++) {
      state = recordAttempt(state, {
        channel: 'email',
        outcome: 'failed',
        attempted_at: new Date(Date.now() + i * 120_000).toISOString(),
        error: `Attempt ${i + 1} failed`,
      });
    }

    const decision = shouldRetryEmail({
      state,
      now: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toContain('Maximum retries exhausted');
  });

  it('does not retry if email already delivered', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'general',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [],
      isMultiChannel: true,
    });

    let state = createInitialState(plan);
    state = recordAttempt(state, {
      channel: 'email',
      outcome: 'succeeded',
      attempted_at: '2024-01-01T10:00:00Z',
    });

    const decision = shouldRetryEmail({
      state,
      now: '2024-01-01T10:02:00Z',
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('Email already delivered');
  });

  it('respects minimum 60s retry interval (R18.9)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'general',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [],
      isMultiChannel: true,
    });

    let state = createInitialState(plan);
    state = recordAttempt(state, {
      channel: 'email',
      outcome: 'failed',
      attempted_at: '2024-01-01T10:00:00Z',
    });

    // Only 30s later — too soon
    const tooSoon = shouldRetryEmail({
      state,
      now: '2024-01-01T10:00:30Z',
    });
    expect(tooSoon.shouldRetry).toBe(false);
    expect(tooSoon.reason).toContain('Minimum retry interval');

    // 61s later — OK
    const okTime = shouldRetryEmail({
      state,
      now: '2024-01-01T10:01:01Z',
    });
    expect(okTime.shouldRetry).toBe(true);
  });

  it('in-app is preserved regardless of email outcome (R18.7, R18.9)', () => {
    const plan = planDelivery({
      notificationId: 'n1',
      notificationType: 'billing',
      storeId: 's1',
      ownerEmail: 'owner@store.com',
      preferences: [],
      isMultiChannel: true,
    });

    let state = createInitialState(plan);

    // In-app succeeds
    state = recordAttempt(state, {
      channel: 'in_app',
      outcome: 'succeeded',
      attempted_at: '2024-01-01T10:00:00Z',
    });

    // Email fails
    state = recordAttempt(state, {
      channel: 'email',
      outcome: 'failed',
      attempted_at: '2024-01-01T10:00:01Z',
      error: 'Network error',
    });

    // In-app still delivered
    expect(state.inAppDelivered).toBe(true);
    // Email not yet delivered
    expect(state.emailDelivered).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('returns false for null', () => {
    expect(isValidEmail(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidEmail(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isValidEmail('   ')).toBe(false);
  });

  it('returns false for malformed emails', () => {
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('missing@')).toBe(false);
    expect(isValidEmail('@nodomain')).toBe(false);
    expect(isValidEmail('user@.com')).toBe(false);
  });

  it('returns true for valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('admin@sub.domain.co')).toBe(true);
    expect(isValidEmail('user+tag@mail.com')).toBe(true);
  });
});

describe('isMandatoryType', () => {
  it('returns true for billing', () => {
    expect(isMandatoryType('billing')).toBe(true);
  });

  it('returns true for suspension', () => {
    expect(isMandatoryType('suspension')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isMandatoryType('general')).toBe(false);
    expect(isMandatoryType('platform_update')).toBe(false);
    expect(isMandatoryType('maintenance')).toBe(false);
  });
});
