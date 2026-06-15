/**
 * Store dashboard/detail routes — paginated list, single detail, per-store metrics.
 *
 * Feature: super-admin-platform
 * Requirements: 2.1, 2.2, 2.4, 2.8, 2.9, 2.10, 6.5, 6.6, 6.7
 *
 * All routes require `requireSuperAdmin`. Uses `getControlPlaneSupabase()` for
 * all DB access — never a store client.
 */
import { Router, type IRouter } from "express";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { filterBySubscriptionStatus } from "../../lib/platform/subscription";
import {
  shapeDashboard,
  type StoreRegistryRow,
  type CachedMetrics,
} from "../../lib/platform/dashboard";
import { validateTimeRange } from "../../lib/platform/range";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /platform/stores — Paginated store list with optional subscription_status filter
// (R2.1, R2.8, R2.9, R2.10, R6.5, R6.6, R6.7)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const cp = getControlPlaneSupabase();

    // Parse pagination params (default page=1, pageSize=20)
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.floor(Number(req.query.pageSize) || 20));

    // Optional subscription_status filter
    const subscriptionStatusFilter = req.query.subscription_status as string | undefined;

    // Fetch all stores from the Store_Registry
    const { data: rawStores, error: storesError } = await cp
      .from("stores")
      .select("id, name, platform_status, subscription_status, subscription_plan_id");

    if (storesError) {
      req.log?.error?.({ err: storesError }, "failed to fetch stores");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // R2.9: empty registry → empty list
    let stores: StoreRegistryRow[] = (rawStores ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      platform_status: s.platform_status,
      subscription_status: s.subscription_status,
      subscription_plan_id: s.subscription_plan_id,
    }));

    // Apply subscription_status filter if provided (R6.6, R6.7)
    if (subscriptionStatusFilter != null && subscriptionStatusFilter !== "") {
      stores = filterBySubscriptionStatus(
        stores as Array<StoreRegistryRow & Record<string, unknown>>,
        subscriptionStatusFilter,
      ) as StoreRegistryRow[];
    }

    // Fetch all store_metrics_cache rows
    const { data: rawMetrics, error: metricsError } = await cp
      .from("store_metrics_cache")
      .select("store_id, order_count, revenue_total, traffic_count, quota_usage, available, fetched_at");

    if (metricsError) {
      req.log?.error?.({ err: metricsError }, "failed to fetch metrics cache");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Build metrics map keyed by store_id
    const metricsCache = new Map<string, CachedMetrics>();
    for (const row of rawMetrics ?? []) {
      metricsCache.set(row.store_id, {
        order_count: row.order_count,
        revenue_total: row.revenue_total != null ? String(row.revenue_total) : null,
        traffic_count: row.traffic_count,
        quota_usage: (row.quota_usage as Record<string, number>) ?? {},
        available: row.available,
        fetched_at: row.fetched_at,
      });
    }

    // Shape via dashboard shaper with pagination (R2.1, R2.8, R2.10)
    const result = shapeDashboard({ stores, metricsCache, page, pageSize });

    // Return house format
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// GET /platform/stores/:id — Single store detail + latest cached metrics
// (R2.4)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores/:id",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Fetch the store (404 if not found)
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id, name, platform_status, subscription_status, subscription_plan_id, owner_email, owner_name, locale, instance_url, metrics_endpoint_url, created_at, updated_at")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch its metrics cache row
    const { data: metricsRow } = await cp
      .from("store_metrics_cache")
      .select("order_count, revenue_total, traffic_count, quota_usage, available, fetched_at")
      .eq("store_id", storeId)
      .single();

    // Shape the metrics (unavailable if no cache row or available=false)
    const metrics = metricsRow && metricsRow.available
      ? {
          order_count: metricsRow.order_count,
          revenue_total: metricsRow.revenue_total != null ? String(metricsRow.revenue_total) : null,
          traffic_count: metricsRow.traffic_count,
          quota_usage: (metricsRow.quota_usage as Record<string, number>) ?? {},
          available: true,
          fetched_at: metricsRow.fetched_at,
        }
      : {
          order_count: null,
          revenue_total: null,
          traffic_count: null,
          quota_usage: {},
          available: false,
          fetched_at: metricsRow?.fetched_at ?? null,
        };

    res.json({
      data: { ...store, metrics },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/stores/:id/metrics?from=&to= — Per-store metrics for a time range
// (R2.2, R2.5)
// ---------------------------------------------------------------------------
router.get(
  "/platform/stores/:id/metrics",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const storeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cp = getControlPlaneSupabase();

    // Validate time range (invalid → 400)
    const rangeResult = validateTimeRange({
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    if (!rangeResult.valid) {
      res.status(400).json({ error: rangeResult.error });
      return;
    }

    // Verify the store exists (404 if not found)
    const { data: store, error: storeError } = await cp
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Fetch cached metrics for this store
    const { data: metricsRow } = await cp
      .from("store_metrics_cache")
      .select("order_count, revenue_total, traffic_count, quota_usage, available, fetched_at")
      .eq("store_id", storeId)
      .single();

    // If no cache row or available=false → return metrics marked unavailable
    if (!metricsRow || !metricsRow.available) {
      res.json({
        data: {
          store_id: storeId,
          order_count: null,
          revenue_total: null,
          traffic_count: null,
          quota_usage: {},
          available: false,
          fetched_at: metricsRow?.fetched_at ?? null,
          range: { from: rangeResult.from, to: rangeResult.to },
        },
      });
      return;
    }

    res.json({
      data: {
        store_id: storeId,
        order_count: metricsRow.order_count,
        revenue_total: metricsRow.revenue_total != null ? String(metricsRow.revenue_total) : null,
        traffic_count: metricsRow.traffic_count,
        quota_usage: (metricsRow.quota_usage as Record<string, number>) ?? {},
        available: true,
        fetched_at: metricsRow.fetched_at,
        range: { from: rangeResult.from, to: rangeResult.to },
      },
    });
  },
);

export default router;
