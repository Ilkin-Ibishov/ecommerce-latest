/**
 * Dashboard list shaper — pure function.
 *
 * Feature: super-admin-platform
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 2.10
 *
 * Logic:
 * 1. Merge store registry rows with cached metrics (by store id)
 * 2. If a store has no metrics cache entry OR available=false → mark metrics
 *    fields as null/unavailable but KEEP the store in the list (never omit)
 * 3. Paginate: default page=1, pageSize=20; total = stores.length; slice accordingly
 * 4. Return in the house format { data, total, page, pageSize }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreRegistryRow {
  id: string;
  name: string;
  platform_status: string;
  subscription_status: string;
  subscription_plan_id: string | null;
}

export interface CachedMetrics {
  order_count: number | null;
  revenue_total: string | null; // numeric as string "123.45"
  traffic_count: number | null;
  quota_usage: Record<string, number>;
  available: boolean;
  fetched_at: string | null;
}

export interface DashboardItemMetrics {
  order_count: number | null;
  revenue_total: string | null;
  traffic_count: number | null;
  quota_usage: Record<string, number>;
  available: boolean;
}

export interface DashboardItem {
  id: string;
  name: string;
  platform_status: string;
  subscription_status: string;
  subscription_plan_id: string | null;
  metrics: DashboardItemMetrics;
}

export interface DashboardResult {
  data: DashboardItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats revenue_total to exactly 2 decimal places when present and valid.
 * Returns null when the value is null or not a valid number.
 */
function formatRevenue(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const num = Number(value);
  if (!isFinite(num)) {
    return null;
  }
  return num.toFixed(2);
}

/**
 * Ensures a count field is a non-negative integer or null.
 */
function normalizeCount(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  const int = Math.max(0, Math.floor(value));
  return int;
}

/**
 * Ensures all quota_usage values are non-negative integers.
 */
function normalizeQuotaUsage(
  usage: Record<string, number> | null | undefined,
): Record<string, number> {
  if (usage == null) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(usage)) {
    result[key] = Math.max(0, Math.floor(val));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Unavailable metrics sentinel
// ---------------------------------------------------------------------------

const UNAVAILABLE_METRICS: DashboardItemMetrics = {
  order_count: null,
  revenue_total: null,
  traffic_count: null,
  quota_usage: {},
  available: false,
};

// ---------------------------------------------------------------------------
// Main shaper
// ---------------------------------------------------------------------------

/**
 * Shape dashboard data from store registry rows + optional cached metrics.
 *
 * @param input.stores       - All stores from the Store_Registry
 * @param input.metricsCache - Cached metrics keyed by store id
 * @param input.page         - 1-based page number (default 1)
 * @param input.pageSize     - Items per page (default 20)
 */
export function shapeDashboard(input: {
  stores: StoreRegistryRow[];
  metricsCache: Map<string, CachedMetrics>;
  page?: number;
  pageSize?: number;
}): DashboardResult {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE));
  const total = input.stores.length;

  // Paginate
  const startIndex = (page - 1) * pageSize;
  const pageStores = input.stores.slice(startIndex, startIndex + pageSize);

  // Shape each row
  const data: DashboardItem[] = pageStores.map((store) => {
    const cached = input.metricsCache.get(store.id);

    let metrics: DashboardItemMetrics;

    if (!cached || !cached.available) {
      // R2.10: unavailable metrics → row present with metric fields marked unavailable
      metrics = UNAVAILABLE_METRICS;
    } else {
      metrics = {
        order_count: normalizeCount(cached.order_count),
        revenue_total: formatRevenue(cached.revenue_total),
        traffic_count: normalizeCount(cached.traffic_count),
        quota_usage: normalizeQuotaUsage(cached.quota_usage),
        available: true,
      };
    }

    return {
      id: store.id,
      name: store.name,
      platform_status: store.platform_status,
      subscription_status: store.subscription_status,
      subscription_plan_id: store.subscription_plan_id,
      metrics,
    };
  });

  return { data, total, page, pageSize };
}
