// Feature: super-admin-platform — unit tests for lib/platform/dashboard.ts
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 2.10

import { describe, it, expect } from "vitest";
import {
  shapeDashboard,
  DEFAULT_PAGE_SIZE,
  type StoreRegistryRow,
  type CachedMetrics,
} from "../src/lib/platform/dashboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<StoreRegistryRow> = {}): StoreRegistryRow {
  return {
    id: overrides.id ?? "store-1",
    name: overrides.name ?? "Test Store",
    platform_status: overrides.platform_status ?? "active",
    subscription_status: overrides.subscription_status ?? "active",
    subscription_plan_id: overrides.subscription_plan_id ?? "plan-1",
  };
}

function makeMetrics(overrides: Partial<CachedMetrics> = {}): CachedMetrics {
  return {
    order_count: overrides.order_count ?? 42,
    revenue_total: overrides.revenue_total ?? "1234.56",
    traffic_count: overrides.traffic_count ?? 500,
    quota_usage: overrides.quota_usage ?? { products: 10 },
    available: overrides.available ?? true,
    fetched_at: overrides.fetched_at ?? "2024-06-15T12:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("shapeDashboard", () => {
  describe("default page size", () => {
    it("DEFAULT_PAGE_SIZE is 20", () => {
      expect(DEFAULT_PAGE_SIZE).toBe(20);
    });
  });

  describe("basic shaping", () => {
    it("merges store registry fields with available metrics", () => {
      const store = makeStore({ id: "s1", name: "Alpha" });
      const metrics = makeMetrics({ order_count: 10, revenue_total: "99.99" });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: "s1",
        name: "Alpha",
        platform_status: "active",
        subscription_status: "active",
        subscription_plan_id: "plan-1",
        metrics: {
          order_count: 10,
          revenue_total: "99.99",
          traffic_count: 500,
          quota_usage: { products: 10 },
          available: true,
        },
      });
    });

    it("exposes subscription_plan_id as distinct from subscription_status", () => {
      const store = makeStore({
        id: "s1",
        subscription_status: "trialing",
        subscription_plan_id: "plan-basic",
      });
      const result = shapeDashboard({
        stores: [store],
        metricsCache: new Map([["s1", makeMetrics()]]),
      });

      expect(result.data[0].subscription_status).toBe("trialing");
      expect(result.data[0].subscription_plan_id).toBe("plan-basic");
    });
  });

  describe("unavailable metrics handling (R2.10)", () => {
    it("keeps store in list when no metrics cache entry exists", () => {
      const store = makeStore({ id: "s1" });
      const result = shapeDashboard({
        stores: [store],
        metricsCache: new Map(),
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].metrics).toEqual({
        order_count: null,
        revenue_total: null,
        traffic_count: null,
        quota_usage: {},
        available: false,
      });
    });

    it("keeps store in list when available=false", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ available: false, order_count: 99 });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].metrics.available).toBe(false);
      // Even though order_count was 99 in the cache, unavailable means null
      expect(result.data[0].metrics.order_count).toBeNull();
    });
  });

  describe("metric formatting", () => {
    it("formats revenue_total to 2 decimal places", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ revenue_total: "1234.5" });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.revenue_total).toBe("1234.50");
    });

    it("returns null for non-numeric revenue_total", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ revenue_total: "not-a-number" });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.revenue_total).toBeNull();
    });

    it("ensures order_count is non-negative integer", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ order_count: -5 });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.order_count).toBe(0);
    });

    it("floors floating-point counts to integers", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ order_count: 3.7, traffic_count: 99.9 });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.order_count).toBe(3);
      expect(result.data[0].metrics.traffic_count).toBe(99);
    });

    it("normalizes quota_usage values to non-negative integers", () => {
      const store = makeStore({ id: "s1" });
      const metrics = makeMetrics({ quota_usage: { products: -2, storage: 5.9 } });
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.quota_usage).toEqual({
        products: 0,
        storage: 5,
      });
    });

    it("returns null for null traffic_count", () => {
      const store = makeStore({ id: "s1" });
      const metrics: CachedMetrics = {
        order_count: 10,
        revenue_total: "100.00",
        traffic_count: null,
        quota_usage: {},
        available: true,
        fetched_at: "2024-06-15T12:00:00.000Z",
      };
      const cache = new Map([["s1", metrics]]);

      const result = shapeDashboard({ stores: [store], metricsCache: cache });
      expect(result.data[0].metrics.traffic_count).toBeNull();
    });
  });

  describe("pagination", () => {
    it("defaults to page=1, pageSize=20", () => {
      const stores = Array.from({ length: 25 }, (_, i) =>
        makeStore({ id: `s${i}` }),
      );
      const result = shapeDashboard({ stores, metricsCache: new Map() });

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(25);
      expect(result.data).toHaveLength(20);
    });

    it("returns second page with remaining items", () => {
      const stores = Array.from({ length: 25 }, (_, i) =>
        makeStore({ id: `s${i}` }),
      );
      const result = shapeDashboard({
        stores,
        metricsCache: new Map(),
        page: 2,
      });

      expect(result.page).toBe(2);
      expect(result.data).toHaveLength(5);
      expect(result.total).toBe(25);
    });

    it("respects custom pageSize", () => {
      const stores = Array.from({ length: 10 }, (_, i) =>
        makeStore({ id: `s${i}` }),
      );
      const result = shapeDashboard({
        stores,
        metricsCache: new Map(),
        pageSize: 3,
        page: 2,
      });

      expect(result.pageSize).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.data[0].id).toBe("s3");
    });

    it("returns empty data for page beyond available items", () => {
      const stores = [makeStore({ id: "s1" })];
      const result = shapeDashboard({
        stores,
        metricsCache: new Map(),
        page: 5,
      });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(1);
    });

    it("treats page < 1 as page 1", () => {
      const stores = [makeStore({ id: "s1" })];
      const result = shapeDashboard({
        stores,
        metricsCache: new Map(),
        page: 0,
      });

      expect(result.page).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it("treats pageSize < 1 as pageSize 1", () => {
      const stores = Array.from({ length: 3 }, (_, i) =>
        makeStore({ id: `s${i}` }),
      );
      const result = shapeDashboard({
        stores,
        metricsCache: new Map(),
        pageSize: 0,
      });

      expect(result.pageSize).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("empty registry (R2.9)", () => {
    it("returns empty data with total 0", () => {
      const result = shapeDashboard({ stores: [], metricsCache: new Map() });
      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    });
  });

  describe("house format", () => {
    it("returns { data, total, page, pageSize } structure", () => {
      const result = shapeDashboard({ stores: [], metricsCache: new Map() });
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("page");
      expect(result).toHaveProperty("pageSize");
    });
  });
});
