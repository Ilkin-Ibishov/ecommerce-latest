/**
 * Store-side platformStatus middleware — pull-with-cache + self-gate pattern.
 *
 * Factory function: `platformStatus(operationKind)` returns an Express middleware
 * that enforces the store's platform_status using a TTL-based in-memory cache
 * populated by periodic pulls from the Control_Plane.
 *
 * Cache behavior:
 *  - TTL ~60s: if cache is fresh, use cached value directly
 *  - If cache is stale: attempt a background (non-blocking) refresh; use last-known value
 *  - If fetch fails and no cache exists: fail-safe to 'active' (Control_Plane outage
 *    never blocks a paying Store)
 *
 * Gate behavior (from lib/store-hooks/platform-status.ts):
 *  - 'active' / 'onboarding' → allow all
 *  - 'suspended' → block admin writes + orders (403), block storefront reads (503),
 *    allow admin reads
 *  - 'disabled' → deny all (403)
 *
 * Feature: super-admin-platform
 * Requirements: 3.3, 3.4, 5.5
 */
import type { Request, Response, NextFunction } from "express";
import { evaluateGate, resolveStatus } from "../lib/store-hooks/platform-status";
import type { OperationKind } from "../lib/store-hooks/platform-status";
import type { PlatformStatus } from "../lib/platform/lifecycle";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  status: PlatformStatus;
  fetchedAt: number; // Date.now() timestamp
}

/** Singleton cache — one per process since a Store instance is single-process. */
let statusCache: CacheEntry | null = null;

/** Whether a background refresh is currently in-flight (prevents concurrent fetches). */
let refreshInFlight = false;

/**
 * Read the PLATFORM_STATUS_URL from env. This is the full URL to the
 * Control_Plane's GET /platform/store-status endpoint.
 */
function getPlatformStatusUrl(): string {
  return process.env.PLATFORM_STATUS_URL ?? "";
}

/**
 * Read the store's own credential from env (used to authenticate to the CP).
 */
function getStoreCredentials(): { storeId: string; secret: string } {
  return {
    storeId: process.env.STORE_ID ?? "",
    secret: process.env.STORE_PLATFORM_SECRET ?? "",
  };
}

/**
 * Fetch the store's platform_status from the Control_Plane.
 * Returns the status string on success, or 'unreachable' on any failure.
 */
async function fetchStatusFromControlPlane(): Promise<PlatformStatus | "unreachable"> {
  const url = getPlatformStatusUrl();
  if (!url) return "unreachable";

  const { storeId, secret } = getStoreCredentials();
  if (!storeId || !secret) return "unreachable";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Store-Id": storeId,
        Authorization: `Bearer ${secret}`,
      },
      signal: AbortSignal.timeout(5000), // 5s timeout to avoid blocking
    });

    if (!response.ok) {
      logger.warn(
        { statusCode: response.status },
        "platform-status fetch returned non-OK",
      );
      return "unreachable";
    }

    const body = (await response.json()) as { platform_status?: string };
    const status = body.platform_status;

    // Validate that it's a known PlatformStatus value
    if (
      status === "onboarding" ||
      status === "active" ||
      status === "suspended" ||
      status === "disabled"
    ) {
      return status;
    }

    logger.warn({ status }, "platform-status fetch returned unknown status");
    return "unreachable";
  } catch (err) {
    logger.warn({ err }, "platform-status fetch failed");
    return "unreachable";
  }
}

/**
 * Attempt a background refresh of the cache. Non-blocking — fires and forgets.
 * Prevents concurrent refresh requests.
 */
function triggerBackgroundRefresh(): void {
  if (refreshInFlight) return;
  refreshInFlight = true;

  fetchStatusFromControlPlane()
    .then((result) => {
      if (result !== "unreachable") {
        statusCache = { status: result, fetchedAt: Date.now() };
      }
    })
    .catch(() => {
      // Swallow — non-critical background operation
    })
    .finally(() => {
      refreshInFlight = false;
    });
}

/**
 * Resolve the current platform status using the cache + fetch logic.
 * This is the synchronous fast-path: reads from cache, triggers async refresh if stale.
 */
function getCurrentStatus(): PlatformStatus {
  const now = Date.now();
  const cacheExpired = statusCache
    ? now - statusCache.fetchedAt > CACHE_TTL_MS
    : true;

  if (statusCache && !cacheExpired) {
    // Cache is fresh — use it directly
    return statusCache.status;
  }

  // Cache is stale or missing — trigger a background refresh
  triggerBackgroundRefresh();

  // Use the resolveStatus logic for the synchronous return:
  // We don't have a fresh fetch result here (it's async/background),
  // so treat fetchResult as 'unreachable' for the sync path.
  return resolveStatus({
    cachedStatus: statusCache?.status ?? null,
    cacheExpired,
    fetchResult: "unreachable",
  });
}

// ---------------------------------------------------------------------------
// Exported factory + helpers
// ---------------------------------------------------------------------------

/**
 * Factory: returns an Express middleware that enforces platform_status for the
 * given operation kind.
 *
 * Usage:
 *   router.post("/orders", platformStatus("order_submit"), ...handler);
 *   router.get("/admin/products", platformStatus("admin_read"), ...handler);
 *   router.post("/admin/products", platformStatus("admin_write"), ...handler);
 *   router.get("/products", platformStatus("storefront_read"), ...handler);
 */
export function platformStatus(
  operationKind: OperationKind,
) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const status = getCurrentStatus();
    const decision = evaluateGate(status, operationKind);

    if (decision.allowed) {
      next();
      return;
    }

    res.status(decision.httpStatus).json({ error: decision.reason });
  };
}

/**
 * Force a synchronous cache refresh (useful in tests or startup).
 * Returns the resolved status after attempting the fetch.
 */
export async function refreshPlatformStatusCache(): Promise<PlatformStatus> {
  const result = await fetchStatusFromControlPlane();

  if (result !== "unreachable") {
    statusCache = { status: result, fetchedAt: Date.now() };
    return result;
  }

  // Apply fail-safe resolution
  return resolveStatus({
    cachedStatus: statusCache?.status ?? null,
    cacheExpired: true,
    fetchResult: "unreachable",
  });
}

/**
 * Reset the cache (useful in tests).
 */
export function resetPlatformStatusCache(): void {
  statusCache = null;
  refreshInFlight = false;
}
