/**
 * Metrics ingest whitelist — pure transform.
 *
 * From an arbitrary Store payload (even one containing raw-record-shaped fields),
 * produce only the whitelisted aggregate fields for `store_metrics_cache`;
 * discard everything else.
 *
 * Feature: super-admin-platform
 * Requirements: 9.2, 9.8
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestedMetrics {
  order_count: number | null;
  revenue_total: string | null; // monetary string "123.45" or null
  traffic_count: number | null; // optional
  quota_usage: Record<string, number>; // { products: 5, admin_users: 2, ... }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const REVENUE_REGEX = /^\d+\.\d{2}$/;

/**
 * Returns `value` if it is a non-negative integer, otherwise `null`.
 */
function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  return value;
}

/**
 * Returns `value` if it is a string matching the 2-decimal monetary format, otherwise `null`.
 */
function asRevenueString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!REVENUE_REGEX.test(value)) return null;
  return value;
}

/**
 * From an unknown `value`, extract only keys with non-negative integer values.
 * Returns an empty object if `value` is not a plain object.
 */
function asQuotaUsage(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const validated = asNonNegativeInt(val);
    if (validated !== null) {
      result[key] = validated;
    }
    // Keys with invalid values are silently excluded
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main ingest function
// ---------------------------------------------------------------------------

/**
 * Accept any unknown payload (could be a full object with extra raw-record fields)
 * and extract ONLY the whitelisted aggregate fields. Everything else is discarded.
 *
 * This function is pure (no side effects).
 */
export function ingestStoreMetrics(payload: unknown): IngestedMetrics {
  // If payload is not an object, return all-null defaults
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      order_count: null,
      revenue_total: null,
      traffic_count: null,
      quota_usage: {},
    };
  }

  const obj = payload as Record<string, unknown>;

  return {
    order_count: asNonNegativeInt(obj.order_count),
    revenue_total: asRevenueString(obj.revenue_total),
    traffic_count: asNonNegativeInt(obj.traffic_count),
    quota_usage: asQuotaUsage(obj.quota_usage),
  };
}
