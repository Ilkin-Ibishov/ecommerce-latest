/**
 * Metrics polling route — scheduler-invoked aggregate-only metrics collection.
 *
 * Feature: super-admin-platform
 * Requirements: 2.2, 2.10, 9.1, 9.2
 *
 * `POST /platform/metrics/poll` is guarded by `requireServiceCredential`
 * (NOT requireSuperAdmin — this is a scheduler endpoint invoked by cron/automation).
 *
 * Logic:
 * 1. Fetch all stores from the Store_Registry (control-plane DB).
 * 2. For each store (sequentially, to avoid overwhelming stores):
 *    a. Call `GET ${store.metrics_endpoint_url}?from=<30daysAgo>&to=<today>`
 *       with `X-Store-Id` and `Authorization: Bearer <per_store_credential_hash>`.
 *    b. On success: pass response through `ingestStoreMetrics()`, upsert into
 *       `store_metrics_cache` with `available=true`, `fetched_at=now()`.
 *    c. On error (network, non-200, timeout): upsert `store_metrics_cache`
 *       with `available=false` — do NOT clear existing cached numbers.
 * 3. Use a 5-second timeout per store (AbortSignal.timeout).
 * 4. Return `{ polled, succeeded, failed }` counts.
 */
import { Router, type IRouter } from "express";
import { requireServiceCredential } from "../../middlewares/requireServiceCredential";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import { ingestStoreMetrics } from "../../lib/platform/metrics-ingest";
import { logger } from "../../lib/logger";
import type { ControlPlanJson } from "@workspace/supabase-types";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ISO date string for N days ago (date-only, no time component).
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * Returns today's ISO date string (date-only).
 */
function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// POST /platform/metrics/poll — Scheduler-invoked metrics collection
// ---------------------------------------------------------------------------
router.post(
  "/platform/metrics/poll",
  requireServiceCredential,
  async (req, res): Promise<void> => {
    const cp = getControlPlaneSupabase();

    // 1. Fetch all stores from the registry
    const { data: stores, error: fetchError } = await cp
      .from("stores")
      .select("id, metrics_endpoint_url, per_store_credential_hash");

    if (fetchError) {
      req.log?.error?.({ err: fetchError }, "metrics poll: failed to fetch stores");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const storeList = stores ?? [];
    let succeeded = 0;
    let failed = 0;

    const fromDate = daysAgo(30);
    const toDate = today();

    // 2. Process stores sequentially (not concurrently) to avoid overwhelming them
    for (const store of storeList) {
      try {
        // 5-second timeout per store
        const response = await fetch(
          `${store.metrics_endpoint_url}?from=${fromDate}&to=${toDate}`,
          {
            method: "GET",
            headers: {
              "X-Store-Id": store.id,
              "Authorization": `Bearer ${store.per_store_credential_hash}`,
            },
            signal: AbortSignal.timeout(5000),
          },
        );

        if (!response.ok) {
          // Non-200 → mark unavailable, don't clear cached numbers
          logger.warn(
            { storeId: store.id, status: response.status },
            "metrics poll: store returned non-200",
          );
          await upsertUnavailable(cp, store.id);
          failed++;
          continue;
        }

        // Parse the response body
        const payload: unknown = await response.json();

        // Pass through the ingest whitelist (R9.2 — only aggregates, never raw records)
        const ingested = ingestStoreMetrics(payload);

        // Upsert into store_metrics_cache with available=true, fresh fetched_at
        const { error: upsertError } = await cp
          .from("store_metrics_cache")
          .upsert(
            {
              store_id: store.id,
              order_count: ingested.order_count,
              revenue_total: ingested.revenue_total != null
                ? parseFloat(ingested.revenue_total)
                : null,
              traffic_count: ingested.traffic_count,
              quota_usage: ingested.quota_usage as unknown as ControlPlanJson,
              available: true,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "store_id" },
          );

        if (upsertError) {
          logger.error(
            { storeId: store.id, err: upsertError },
            "metrics poll: failed to upsert metrics",
          );
          failed++;
          continue;
        }

        succeeded++;
      } catch (err: unknown) {
        // Network error, timeout (AbortError), or JSON parse error
        logger.warn(
          { storeId: store.id, err },
          "metrics poll: store unreachable or error",
        );
        await upsertUnavailable(cp, store.id);
        failed++;
      }
    }

    // 3. Return summary
    res.json({
      polled: storeList.length,
      succeeded,
      failed,
    });
  },
);

// ---------------------------------------------------------------------------
// Internal helper: mark a store's cached metrics as unavailable
// ---------------------------------------------------------------------------

/**
 * Upserts into `store_metrics_cache` with `available=false` and a fresh
 * `fetched_at` timestamp. Existing cached numbers are NOT cleared — only the
 * availability flag is updated (R2.10: the Store still appears with its
 * registry fields, metric fields marked unavailable rather than dropped).
 */
async function upsertUnavailable(
  cp: ReturnType<typeof getControlPlaneSupabase>,
  storeId: string,
): Promise<void> {
  const { error } = await cp
    .from("store_metrics_cache")
    .upsert(
      {
        store_id: storeId,
        available: false,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

  if (error) {
    logger.error(
      { storeId, err: error },
      "metrics poll: failed to mark store unavailable",
    );
  }
}

export default router;
