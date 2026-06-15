/**
 * Time-range/period validation and inclusive windowing — pure functions.
 *
 * Feature: super-admin-platform
 * Requirements: 2.5, 2.6, 2.7
 *
 * Logic:
 * 1. Both absent → default last 30 days (inclusive endpoints)
 * 2. One present, other missing → error
 * 3. Non-parseable ISO dates → error
 * 4. start > end → error
 * 5. Range exceeds 366 days → error
 * 6. Otherwise → valid with inclusive ISO date strings
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RangeValidationResult =
  | { valid: true; from: string; to: string }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns today's date as an ISO date string (YYYY-MM-DD) using UTC.
 * Extracted so it can be overridden in tests via dependency injection.
 */
function todayISO(now?: Date): string {
  const d = now ?? new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the date `days` before the given date as ISO date string.
 */
function daysAgoISO(days: number, now?: Date): string {
  const d = now ?? new Date();
  const past = new Date(d.getTime() - days * MS_PER_DAY);
  return past.toISOString().slice(0, 10);
}

/**
 * Parse an ISO date string. Returns the Date object if valid, null otherwise.
 * Accepts full ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ).
 */
function parseDate(value: string): Date | null {
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return null;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a time range for platform queries.
 *
 * @param input.from - start of range (ISO date string, optional)
 * @param input.to   - end of range (ISO date string, optional)
 * @param now        - optional "current time" for testing (defaults to new Date())
 *
 * Returns a discriminated union:
 * - { valid: true, from: string, to: string } with ISO date strings (inclusive endpoints)
 * - { valid: false, error: string } with a human-readable error message
 */
export function validateTimeRange(
  input: { from?: string | null; to?: string | null },
  now?: Date,
): RangeValidationResult {
  const fromPresent = input.from != null && input.from !== '';
  const toPresent = input.to != null && input.to !== '';

  // 1. Both absent → default to last 30 days
  if (!fromPresent && !toPresent) {
    return {
      valid: true,
      from: daysAgoISO(DEFAULT_RANGE_DAYS, now),
      to: todayISO(now),
    };
  }

  // 2. One present, other missing
  if (!fromPresent || !toPresent) {
    return {
      valid: false,
      error: 'Both from and to are required when a time range is specified',
    };
  }

  // 3. Parse both as ISO dates
  const fromDate = parseDate(input.from!);
  const toDate = parseDate(input.to!);

  if (!fromDate) {
    return { valid: false, error: 'Invalid date format for from/to' };
  }
  if (!toDate) {
    return { valid: false, error: 'Invalid date format for from/to' };
  }

  // 4. start > end
  if (fromDate.getTime() > toDate.getTime()) {
    return { valid: false, error: 'Time range start must not be after end' };
  }

  // 5. Range exceeds 366 days
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffDays = diffMs / MS_PER_DAY;
  if (diffDays > MAX_RANGE_DAYS) {
    return { valid: false, error: 'Time range must not exceed 366 days' };
  }

  // 6. Valid — return inclusive endpoints as ISO date strings
  return {
    valid: true,
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
  };
}
