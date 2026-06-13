import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyCounter {
  count: number;
  resetDate: string; // ISO date string (YYYY-MM-DD)
}

// ---------------------------------------------------------------------------
// In-memory daily counters
// ---------------------------------------------------------------------------

/**
 * In-memory store for daily API call counters, keyed by service name.
 *
 * This avoids needing a database table since the API server runs as a single
 * instance. If the server restarts, the counter resets — acceptable for rate
 * limiting since the UPCitemdb free tier is 100/day and restarts are rare.
 */
const counters = new Map<string, DailyCounter>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrResetCounter(service: string): DailyCounter {
  const today = getTodayDate();
  const existing = counters.get(service);

  if (existing && existing.resetDate === today) {
    return existing;
  }

  // Reset counter for new day (or first access)
  if (existing && existing.resetDate !== today) {
    logger.info(
      { service, previousCount: existing.count, previousDate: existing.resetDate },
      "Daily rate limit counter reset"
    );
  }

  const fresh: DailyCounter = { count: 0, resetDate: today };
  counters.set(service, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the daily limit for a service has been reached.
 *
 * @param service - Identifier for the external service (e.g. "barcode-lookup")
 * @param maxPerDay - Maximum number of allowed calls per day
 * @returns `true` if the limit has NOT been exceeded (call is allowed),
 *          `false` if the limit IS exceeded (call should be rejected)
 */
export async function checkDailyLimit(service: string, maxPerDay: number): Promise<boolean> {
  const counter = getOrResetCounter(service);
  return counter.count < maxPerDay;
}

/**
 * Increment the daily call count for a service.
 * Should be called after a successful API call to the external service.
 *
 * @param service - Identifier for the external service (e.g. "barcode-lookup")
 */
export async function incrementDailyCount(service: string): Promise<void> {
  const counter = getOrResetCounter(service);
  counter.count += 1;

  logger.info(
    { service, count: counter.count, date: counter.resetDate },
    "Rate limit counter incremented"
  );
}

// ---------------------------------------------------------------------------
// Testing helpers (exported for unit tests only)
// ---------------------------------------------------------------------------

/** @internal Reset all counters — for testing only */
export function _resetCounters(): void {
  counters.clear();
}

/** @internal Get current count for a service — for testing only */
export function _getCount(service: string): number {
  const counter = counters.get(service);
  return counter ? counter.count : 0;
}
