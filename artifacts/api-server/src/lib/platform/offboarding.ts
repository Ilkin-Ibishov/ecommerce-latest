/**
 * Offboarding state machine and guards — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 16.9
 *
 * The offboarding lifecycle:
 *   1. initiate → sets 30-day retention window
 *   2. during retention → export allowed, restore allowed
 *   3. after retention window expires → export rejected, purge due within 24h
 *   4. purge → requires explicit confirmation matching target Store
 *   5. after purge → restore rejected (irrecoverable)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OffboardingPhase =
  | 'active'          // Store is live, not offboarded
  | 'retention'       // 30-day retention window active
  | 'retention_expired' // retention window ended, purge due within 24h
  | 'purged';         // permanently purged, irrecoverable

export interface OffboardingRecord {
  storeId: string;
  phase: OffboardingPhase;
  initiatedAt: string;       // ISO timestamp
  retentionEndsAt: string;   // ISO timestamp (initiatedAt + 30 days)
  preOffboardingStatus: string; // platform_status before offboarding
  purgedAt: string | null;   // ISO timestamp of purge, null if not purged
  restoredAt: string | null; // ISO timestamp of restore, null if not restored
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type InitiateResult =
  | { success: true; record: OffboardingRecord }
  | { success: false; reason: 'already_offboarding' | 'already_purged' };

export type RestoreResult =
  | { success: true; restoredStatus: string; record: OffboardingRecord }
  | { success: false; reason: 'not_offboarding' | 'retention_expired' | 'irrecoverable' };

export type ExportResult =
  | { success: true }
  | { success: false; reason: 'not_offboarding' | 'retention_expired' | 'purged' };

export type PurgeResult =
  | { success: true; record: OffboardingRecord }
  | { success: false; reason: 'not_offboarding' | 'confirmation_mismatch' | 'already_purged' };

export type RetentionCheckResult =
  | { expired: false }
  | { expired: true; purgeDueBy: string }; // ISO timestamp within 24h of expiry

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retention window in days */
export const RETENTION_DAYS = 30;

/** Purge must happen within this many hours of retention expiry */
export const PURGE_WINDOW_HOURS = 24;

// ---------------------------------------------------------------------------
// Simplified guard functions for Property 27
// ---------------------------------------------------------------------------

/**
 * Determines whether offboarding can be initiated for a store given its
 * current platform status. Only 'active', 'suspended', and 'disabled' stores
 * may be offboarded. Stores still in 'onboarding' cannot be offboarded.
 *
 * Requirements: 16.1
 */
export function canInitiateOffboarding(currentStatus: string): boolean {
  return currentStatus === 'active' || currentStatus === 'suspended' || currentStatus === 'disabled';
}

/**
 * Determines whether a store can be restored from offboarding.
 * Restore is allowed only when:
 *   - The store has NOT been purged
 *   - The retention window has NOT ended
 *
 * Requirements: 16.3, 16.5
 */
export function canRestore(input: { purged: boolean; retentionEnded: boolean }): { success: true } | { success: false; error: string } {
  if (input.purged) {
    return { success: false, error: 'Store has been purged and is irrecoverable' };
  }
  if (input.retentionEnded) {
    return { success: false, error: 'Retention period has ended' };
  }
  return { success: true };
}

/**
 * Determines whether an export of a store's Control_Plane records is allowed.
 * Export is allowed only when:
 *   - The store has NOT been purged
 *   - The retention window has NOT ended
 *
 * Requirements: 16.9
 */
export function canExport(input: { purged: boolean; retentionEnded: boolean }): { success: true } | { success: false; error: string } {
  if (input.purged) {
    return { success: false, error: 'Store has been purged and records are no longer available' };
  }
  if (input.retentionEnded) {
    return { success: false, error: 'Retention period has ended and records are no longer available for export' };
  }
  return { success: true };
}

/**
 * Determines whether a purge can proceed.
 * Purge is allowed only when the explicit confirmation matches the expected
 * confirmation (target Store identifier).
 *
 * Requirements: 16.6
 */
export function canPurge(input: { confirmation: string; expectedConfirmation: string }): { success: true } | { success: false; error: string } {
  if (input.confirmation !== input.expectedConfirmation) {
    return { success: false, error: 'Confirmation does not match the target store' };
  }
  return { success: true };
}

/**
 * Computes the retention end date (30 calendar days from initiation).
 *
 * Requirements: 16.1, 16.4
 */
export function computeRetentionEnd(initiatedAt: Date): Date {
  const result = new Date(initiatedAt.getTime());
  result.setUTCDate(result.getUTCDate() + RETENTION_DAYS);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function addHours(isoDate: string, hours: number): string {
  const d = new Date(isoDate);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

/**
 * Determine the current phase of an offboarding record given the current time.
 */
export function resolvePhase(record: OffboardingRecord, now: string): OffboardingPhase {
  if (record.phase === 'purged') return 'purged';
  if (record.phase === 'active') return 'active';

  // Check if retention window has expired
  const retentionEnd = new Date(record.retentionEndsAt).getTime();
  const nowMs = new Date(now).getTime();

  if (nowMs >= retentionEnd) {
    return 'retention_expired';
  }
  return 'retention';
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Initiate offboarding for a Store.
 * Sets up a 30-day retention period. Records the pre-offboarding platform status.
 *
 * Requirements: 16.1
 */
export function initiateOffboarding(
  storeId: string,
  currentPlatformStatus: string,
  now: string,
  existingRecord: OffboardingRecord | null,
): InitiateResult {
  // Cannot re-initiate if already in retention or retention_expired
  if (existingRecord) {
    const currentPhase = resolvePhase(existingRecord, now);
    if (currentPhase === 'purged') {
      return { success: false, reason: 'already_purged' };
    }
    if (currentPhase === 'retention' || currentPhase === 'retention_expired') {
      return { success: false, reason: 'already_offboarding' };
    }
  }

  const record: OffboardingRecord = {
    storeId,
    phase: 'retention',
    initiatedAt: now,
    retentionEndsAt: addDays(now, RETENTION_DAYS),
    preOffboardingStatus: currentPlatformStatus,
    purgedAt: null,
    restoredAt: null,
  };

  return { success: true, record };
}

/**
 * Restore an offboarded Store before the retention window closes.
 * Returns the Store to its pre-offboarding platform status with records intact.
 *
 * Requirements: 16.3, 16.5
 */
export function restoreOffboarding(
  record: OffboardingRecord | null,
  now: string,
): RestoreResult {
  if (!record) {
    return { success: false, reason: 'not_offboarding' };
  }

  const currentPhase = resolvePhase(record, now);

  switch (currentPhase) {
    case 'active':
      return { success: false, reason: 'not_offboarding' };

    case 'retention': {
      const restoredRecord: OffboardingRecord = {
        ...record,
        phase: 'active',
        restoredAt: now,
      };
      return {
        success: true,
        restoredStatus: record.preOffboardingStatus,
        record: restoredRecord,
      };
    }

    case 'retention_expired':
      return { success: false, reason: 'retention_expired' };

    case 'purged':
      return { success: false, reason: 'irrecoverable' };

    default: {
      const _exhaustive: never = currentPhase;
      return { success: false, reason: 'not_offboarding' };
    }
  }
}

/**
 * Check if an export is allowed for an offboarded Store.
 *
 * Requirements: 16.9
 */
export function checkExportAllowed(
  record: OffboardingRecord | null,
  now: string,
): ExportResult {
  if (!record) {
    return { success: false, reason: 'not_offboarding' };
  }

  const currentPhase = resolvePhase(record, now);

  switch (currentPhase) {
    case 'active':
      return { success: false, reason: 'not_offboarding' };

    case 'retention':
      return { success: true };

    case 'retention_expired':
      return { success: false, reason: 'retention_expired' };

    case 'purged':
      return { success: false, reason: 'purged' };

    default: {
      const _exhaustive: never = currentPhase;
      return { success: false, reason: 'not_offboarding' };
    }
  }
}

/**
 * Purge a Store's Control_Plane records.
 * Requires explicit confirmation matching the target Store identifier.
 *
 * Requirements: 16.6
 */
export function purgeOffboarding(
  record: OffboardingRecord | null,
  confirmationStoreId: string,
  now: string,
): PurgeResult {
  if (!record) {
    return { success: false, reason: 'not_offboarding' };
  }

  const currentPhase = resolvePhase(record, now);

  if (currentPhase === 'active') {
    return { success: false, reason: 'not_offboarding' };
  }

  if (currentPhase === 'purged') {
    return { success: false, reason: 'already_purged' };
  }

  // Confirmation must match the target Store
  if (confirmationStoreId !== record.storeId) {
    return { success: false, reason: 'confirmation_mismatch' };
  }

  const purgedRecord: OffboardingRecord = {
    ...record,
    phase: 'purged',
    purgedAt: now,
  };

  return { success: true, record: purgedRecord };
}

/**
 * Check if the retention window has expired and purge is due.
 * Returns the deadline by which purge must happen (within 24h of expiry).
 *
 * Requirements: 16.4
 */
export function checkRetentionExpiry(
  record: OffboardingRecord,
  now: string,
): RetentionCheckResult {
  const currentPhase = resolvePhase(record, now);

  if (currentPhase === 'retention_expired') {
    return {
      expired: true,
      purgeDueBy: addHours(record.retentionEndsAt, PURGE_WINDOW_HOURS),
    };
  }

  return { expired: false };
}
