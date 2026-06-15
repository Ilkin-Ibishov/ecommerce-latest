// Feature: super-admin-platform, Property 5: The Control_Plane persists only aggregate numbers from a Store, never raw records
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ingestStoreMetrics } from "../src/lib/platform/metrics-ingest";

/**
 * Property 5: The Control_Plane persists only aggregate numbers from a Store, never raw records
 *
 * **Validates: Requirements 9.2, 9.8**
 *
 * The metrics ingest whitelist must:
 * - Only output { order_count, revenue_total, traffic_count, quota_usage } — never any other field
 * - Discard any extra fields from the input (especially raw-record-shaped arrays like orders, customers, products)
 * - order_count/traffic_count: null or non-negative integer
 * - revenue_total: null or matches /^\d+\.\d{2}$/
 * - quota_usage: object with non-negative integer values only
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid non-negative integer */
const nonNegIntArb = fc.integer({ min: 0, max: 999_999_999 });

/** Generate a valid revenue string (2 decimal places) */
const revenueStringArb = fc
  .tuple(fc.integer({ min: 0, max: 999_999_999 }), fc.integer({ min: 0, max: 99 }))
  .map(([whole, cents]) => `${whole}.${String(cents).padStart(2, "0")}`);

/** Generate a valid quota_usage object */
const quotaUsageArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  nonNegIntArb,
  { minKeys: 0, maxKeys: 5 }
);

/** Generate raw-record-shaped extra fields that should be discarded */
const rawRecordFieldsArb = fc.record({
  orders: fc.array(fc.record({ id: fc.uuid(), amount: fc.float() }), { minLength: 0, maxLength: 5 }),
  customers: fc.array(fc.record({ email: fc.emailAddress(), name: fc.string() }), { minLength: 0, maxLength: 5 }),
  products: fc.array(fc.record({ sku: fc.string(), price: fc.float() }), { minLength: 0, maxLength: 5 }),
  raw_data: fc.anything(),
  internal_records: fc.anything(),
});

/** Generate a payload with valid aggregate fields plus extra garbage */
const payloadWithExtrasArb = fc
  .tuple(
    fc.option(nonNegIntArb, { nil: undefined }),
    fc.option(revenueStringArb, { nil: undefined }),
    fc.option(nonNegIntArb, { nil: undefined }),
    fc.option(quotaUsageArb, { nil: undefined }),
    rawRecordFieldsArb
  )
  .map(([order_count, revenue_total, traffic_count, quota_usage, extras]) => ({
    ...extras,
    ...(order_count !== undefined ? { order_count } : {}),
    ...(revenue_total !== undefined ? { revenue_total } : {}),
    ...(traffic_count !== undefined ? { traffic_count } : {}),
    ...(quota_usage !== undefined ? { quota_usage } : {}),
  }));

/** Generate completely arbitrary payloads */
const arbitraryPayloadArb = fc.oneof(
  fc.anything(),
  payloadWithExtrasArb,
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.anything()),
  fc.string()
);

// ─── Property Tests ─────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 5: The Control_Plane persists only aggregate numbers from a Store, never raw records", () => {
  describe("output shape is always exactly the whitelisted fields", () => {
    it("result ONLY contains order_count, revenue_total, traffic_count, quota_usage — never any other field", () => {
      fc.assert(
        fc.property(arbitraryPayloadArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          const keys = Object.keys(result).sort();
          expect(keys).toEqual(["order_count", "quota_usage", "revenue_total", "traffic_count"]);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("extra fields from input are NEVER present in the output", () => {
    it("raw-record-shaped fields (orders, customers, products, etc.) are always discarded", () => {
      fc.assert(
        fc.property(payloadWithExtrasArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          const resultKeys = Object.keys(result);

          // None of the extra fields should appear
          expect(resultKeys).not.toContain("orders");
          expect(resultKeys).not.toContain("customers");
          expect(resultKeys).not.toContain("products");
          expect(resultKeys).not.toContain("raw_data");
          expect(resultKeys).not.toContain("internal_records");

          // Only whitelisted keys
          for (const key of resultKeys) {
            expect(["order_count", "revenue_total", "traffic_count", "quota_usage"]).toContain(key);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("order_count and traffic_count validation", () => {
    it("order_count is null or a non-negative integer", () => {
      fc.assert(
        fc.property(arbitraryPayloadArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          if (result.order_count !== null) {
            expect(typeof result.order_count).toBe("number");
            expect(Number.isInteger(result.order_count)).toBe(true);
            expect(result.order_count).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 }
      );
    });

    it("traffic_count is null or a non-negative integer", () => {
      fc.assert(
        fc.property(arbitraryPayloadArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          if (result.traffic_count !== null) {
            expect(typeof result.traffic_count).toBe("number");
            expect(Number.isInteger(result.traffic_count)).toBe(true);
            expect(result.traffic_count).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("revenue_total validation", () => {
    it("revenue_total is null or matches /^\\d+\\.\\d{2}$/", () => {
      fc.assert(
        fc.property(arbitraryPayloadArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          if (result.revenue_total !== null) {
            expect(typeof result.revenue_total).toBe("string");
            expect(result.revenue_total).toMatch(/^\d+\.\d{2}$/);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("quota_usage validation", () => {
    it("quota_usage values are all non-negative integers", () => {
      fc.assert(
        fc.property(arbitraryPayloadArb, (payload) => {
          const result = ingestStoreMetrics(payload);
          expect(typeof result.quota_usage).toBe("object");
          expect(result.quota_usage).not.toBeNull();
          expect(Array.isArray(result.quota_usage)).toBe(false);

          for (const [, value] of Object.entries(result.quota_usage)) {
            expect(typeof value).toBe("number");
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("valid aggregate inputs are preserved correctly", () => {
    it("valid order_count, revenue_total, traffic_count, and quota_usage pass through", () => {
      fc.assert(
        fc.property(
          nonNegIntArb,
          revenueStringArb,
          nonNegIntArb,
          quotaUsageArb,
          (orderCount, revenue, trafficCount, quotaUsage) => {
            const payload = {
              order_count: orderCount,
              revenue_total: revenue,
              traffic_count: trafficCount,
              quota_usage: quotaUsage,
            };
            const result = ingestStoreMetrics(payload);
            expect(result.order_count).toBe(orderCount);
            expect(result.revenue_total).toBe(revenue);
            expect(result.traffic_count).toBe(trafficCount);
            expect(result.quota_usage).toEqual(quotaUsage);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
