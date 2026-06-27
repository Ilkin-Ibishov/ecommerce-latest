import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  shapeDashboard,
  DEFAULT_PAGE_SIZE,
  type StoreRegistryRow,
  type CachedMetrics,
} from "../src/lib/platform/dashboard";
import { filterBySubscriptionStatus } from "../src/lib/platform/subscription";

/**
 * Dashboard Shaper & Subscription Filter Property Tests
 *
 * Implementations under test:
 * - `src/lib/platform/dashboard.ts` — `shapeDashboard` pure shaper
 * - `src/lib/platform/subscription.ts` — `filterBySubscriptionStatus` pure filter
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.10, 6.5, 6.6, 6.7**
 */

// ─── Generators ──────────────────────────────────────────────────────────────

const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
] as const;

const PLATFORM_STATUSES = ["active", "suspended", "pending"] as const;

/** A store registry row (pre-merge with metrics). */
const storeRegistryRowArb: fc.Arbitrary<StoreRegistryRow> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 80 }),
  platform_status: fc.constantFrom(...PLATFORM_STATUSES),
  subscription_status: fc.constantFrom(...SUBSCRIPTION_STATUSES),
  subscription_plan_id: fc.option(fc.uuid(), { nil: null }),
});

/** Cached metrics entry — `available` toggles availability, includes "unavailable" entries. */
const cachedMetricsArb: fc.Arbitrary<CachedMetrics> = fc.record({
  // Counts may be fractional/negative in raw cache — shaper must normalize.
  order_count: fc.option(fc.integer({ min: -50, max: 100_000 }), { nil: null }),
  revenue_total: fc.option(
    fc.oneof(
      fc.float({ min: 0, max: 1_000_000, noNaN: true }).map((n) => String(n)),
      fc.constantFrom("123.4", "0", "99.999", "1000"),
      fc.constant("not-a-number"),
    ),
    { nil: null },
  ),
  traffic_count: fc.option(fc.integer({ min: -50, max: 100_000 }), {
    nil: null,
  }),
  quota_usage: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 12 }),
    fc.integer({ min: -10, max: 10_000 }),
    { maxKeys: 5 },
  ),
  available: fc.boolean(),
  fetched_at: fc.option(fc.date().map((d) => d.toISOString()), { nil: null }),
});

/** A set of stores with unique ids. */
const storeSetArb = (opts?: { minLength?: number; maxLength?: number }) =>
  fc.uniqueArray(storeRegistryRowArb, {
    selector: (s) => s.id,
    minLength: opts?.minLength ?? 0,
    maxLength: opts?.maxLength ?? 60,
  });

// ─── Property 18: Dashboard list shape, metric formatting, unavailable handling ──

// Feature: super-admin-platform, Property 18: Dashboard list shape, metric formatting, and unavailable-metric handling
describe("Feature: super-admin-platform, Property 18: Dashboard list shape, metric formatting, and unavailable-metric handling", () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.10**
   *
   * For any store set with arbitrary cached metrics (some unavailable),
   * each shaped row exposes name, platform_status, subscription_status, and
   * plan (distinct from status); counts are non-negative integers or null;
   * revenue is formatted to 2 decimals or null; quota values are non-negative
   * integers; pagination defaults to page size 20; and stores with unavailable
   * metrics still appear with their metric fields marked unavailable (never omitted).
   */
  it("shaped rows have correct shape, formatting, and never omit unavailable-metric stores", () => {
    fc.assert(
      fc.property(
        storeSetArb({ maxLength: 60 }),
        // For each store, decide independently whether it has a cache entry.
        fc.array(fc.option(cachedMetricsArb, { nil: undefined }), {
          maxLength: 60,
        }),
        (stores, metricsList) => {
          // Build the metrics cache for whichever stores got a (defined) entry.
          const metricsCache = new Map<string, CachedMetrics>();
          stores.forEach((store, i) => {
            const m = metricsList[i];
            if (m !== undefined) {
              metricsCache.set(store.id, m);
            }
          });

          const result = shapeDashboard({ stores, metricsCache });

          // Total reflects the full store set; defaults applied.
          expect(result.total).toBe(stores.length);
          expect(result.page).toBe(1);
          expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
          expect(DEFAULT_PAGE_SIZE).toBe(20);

          // Page size 20 cap: never more rows than the page size.
          expect(result.data.length).toBeLessThanOrEqual(20);
          expect(result.data.length).toBe(Math.min(stores.length, 20));

          // The rows correspond, in order, to the first page of stores.
          const expectedPage = stores.slice(0, 20);

          result.data.forEach((row, idx) => {
            const source = expectedPage[idx];

            // Registry fields preserved.
            expect(row.id).toBe(source.id);
            expect(row.name).toBe(source.name);
            expect(row.platform_status).toBe(source.platform_status);
            expect(row.subscription_status).toBe(source.subscription_status);

            // Plan is distinct from status: separate field carried through.
            expect(row.subscription_plan_id).toBe(source.subscription_plan_id);
            expect(row).toHaveProperty("subscription_plan_id");

            // Metrics object is always present (never omitted).
            expect(row).toHaveProperty("metrics");
            const m = row.metrics;
            expect(m).toHaveProperty("order_count");
            expect(m).toHaveProperty("revenue_total");
            expect(m).toHaveProperty("traffic_count");
            expect(m).toHaveProperty("quota_usage");
            expect(m).toHaveProperty("available");

            const cached = metricsCache.get(source.id);
            const isAvailable = cached != null && cached.available === true;

            if (!isAvailable) {
              // R2.10: unavailable → present row, metric fields marked unavailable.
              expect(m.available).toBe(false);
              expect(m.order_count).toBeNull();
              expect(m.revenue_total).toBeNull();
              expect(m.traffic_count).toBeNull();
              expect(m.quota_usage).toEqual({});
            } else {
              expect(m.available).toBe(true);

              // Counts: non-negative integers or null.
              for (const count of [m.order_count, m.traffic_count]) {
                if (count !== null) {
                  expect(Number.isInteger(count)).toBe(true);
                  expect(count).toBeGreaterThanOrEqual(0);
                }
              }

              // Revenue: either null or a string formatted to exactly 2 decimals.
              if (m.revenue_total !== null) {
                expect(typeof m.revenue_total).toBe("string");
                expect(m.revenue_total).toMatch(/^-?\d+\.\d{2}$/);
                // Formatted value is non-negative since sources are >= 0.
                expect(Number(m.revenue_total)).toBeGreaterThanOrEqual(0);
              }

              // Quota usage: all values non-negative integers.
              for (const v of Object.values(m.quota_usage)) {
                expect(Number.isInteger(v)).toBe(true);
                expect(v).toBeGreaterThanOrEqual(0);
              }
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.8, 2.10**
   *
   * Every store in the set is represented across pages — none is ever dropped,
   * regardless of metric availability. Concatenating all pages yields exactly
   * the input store ids in order.
   */
  it("pagination preserves every store across pages (unavailable metrics never drop a store)", () => {
    fc.assert(
      fc.property(
        storeSetArb({ minLength: 1, maxLength: 55 }),
        fc.array(fc.option(cachedMetricsArb, { nil: undefined }), {
          maxLength: 55,
        }),
        (stores, metricsList) => {
          const metricsCache = new Map<string, CachedMetrics>();
          stores.forEach((store, i) => {
            const m = metricsList[i];
            if (m !== undefined) metricsCache.set(store.id, m);
          });

          const pageSize = DEFAULT_PAGE_SIZE;
          const pageCount = Math.max(1, Math.ceil(stores.length / pageSize));

          const collectedIds: string[] = [];
          for (let page = 1; page <= pageCount; page++) {
            const res = shapeDashboard({ stores, metricsCache, page });
            expect(res.total).toBe(stores.length);
            for (const row of res.data) {
              collectedIds.push(row.id);
            }
          }

          // Exactly the input ids, in order, no omissions or duplicates.
          expect(collectedIds).toEqual(stores.map((s) => s.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 17: Subscription-status filtering returns exactly matching Stores ──

// Feature: super-admin-platform, Property 17: Subscription-status filtering returns exactly matching Stores
describe("Feature: super-admin-platform, Property 17: Subscription-status filtering returns exactly matching Stores", () => {
  /**
   * **Validates: Requirements 6.5, 6.6, 6.7**
   *
   * For any store set and any target subscription_status value, the filter
   * returns exactly the stores whose subscription_status equals the target,
   * preserving order, and an empty array when none match.
   */
  it("returns exactly the stores whose subscription_status equals the target", () => {
    fc.assert(
      fc.property(
        storeSetArb({ maxLength: 80 }),
        fc.constantFrom(...SUBSCRIPTION_STATUSES),
        (stores, target) => {
          const result = filterBySubscriptionStatus(stores, target);

          // Every returned store matches the target.
          for (const store of result) {
            expect(store.subscription_status).toBe(target);
          }

          // Count equals the number of matching stores in the input.
          const expectedMatches = stores.filter(
            (s) => s.subscription_status === target,
          );
          expect(result.length).toBe(expectedMatches.length);

          // Exact membership, order-preserving.
          expect(result).toEqual(expectedMatches);

          // No matching store is left out.
          const resultIds = new Set(result.map((s) => s.id));
          for (const store of stores) {
            if (store.subscription_status === target) {
              expect(resultIds.has(store.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * When no store matches the target subscription_status, the filter returns
   * an empty array.
   */
  it("returns an empty array when no store matches the target status", () => {
    fc.assert(
      fc.property(
        storeSetArb({ maxLength: 80 }),
        fc.constantFrom(...SUBSCRIPTION_STATUSES),
        (stores, target) => {
          // Remove any store that would match the target.
          const nonMatching = stores.filter(
            (s) => s.subscription_status !== target,
          );
          const result = filterBySubscriptionStatus(nonMatching, target);
          expect(result).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5, 6.6**
   *
   * A status value outside the known set matches nothing in a set built only
   * from valid statuses, so the filter returns an empty array.
   */
  it("returns an empty array for a target status that appears in no store", () => {
    fc.assert(
      fc.property(storeSetArb({ maxLength: 80 }), (stores) => {
        const result = filterBySubscriptionStatus(stores, "__no_such_status__");
        expect(result).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
