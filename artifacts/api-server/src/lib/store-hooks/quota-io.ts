/**
 * Store-side quota I/O helpers — fetching effective limits from the Control_Plane
 * and counting live usage from the store's own database.
 *
 * Separated from the pure quota.ts logic to keep I/O testable independently
 * and allow the pure functions to remain side-effect-free.
 *
 * Feature: super-admin-platform
 * Requirements: 15.1, 15.2, 15.6, 15.7
 */
import { getAdminSupabase } from "../supabase";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuotaLimits = Record<string, number> | null;

// ---------------------------------------------------------------------------
// Effective limits fetch — from Control_Plane via PLATFORM_QUOTA_URL
// ---------------------------------------------------------------------------

/**
 * TTL cache for quota limits fetched from the Control_Plane.
 * Same pattern as platformStatus: short TTL, fail-safe to null (→ 0 limits).
 */
const QUOTA_LIMITS_TTL_MS = 60_000; // 60 seconds

interface LimitsCache {
  limits: QuotaLimits;
  fetchedAt: number;
}

let limitsCache: LimitsCache | null = null;

/**
 * Read the PLATFORM_QUOTA_URL from env.
 * This is the Control_Plane endpoint that returns quota limits for this store.
 */
function getPlatformQuotaUrl(): string {
  return process.env.PLATFORM_QUOTA_URL ?? "";
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
 * Fetch effective quota limits from the Control_Plane.
 *
 * Uses a short TTL cache (~60s). On fetch failure, returns last-known cached value
 * or null (which downstream means all limits are 0 → R15.11).
 *
 * Expected response format from Control_Plane:
 *   { "quota_limits": { "products": 100, "admin_users": 5, "orders_monthly": 500 } }
 */
export async function fetchQuotaLimits(): Promise<QuotaLimits> {
  const now = Date.now();

  // Return cached if fresh
  if (limitsCache && now - limitsCache.fetchedAt < QUOTA_LIMITS_TTL_MS) {
    return limitsCache.limits;
  }

  const url = getPlatformQuotaUrl();
  if (!url) {
    // No URL configured — treat as no plan assigned (R15.11)
    return limitsCache?.limits ?? null;
  }

  const { storeId, secret } = getStoreCredentials();
  if (!storeId || !secret) {
    return limitsCache?.limits ?? null;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Store-Id": storeId,
        Authorization: `Bearer ${secret}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn(
        { statusCode: response.status },
        "quota-limits fetch returned non-OK",
      );
      return limitsCache?.limits ?? null;
    }

    const body = (await response.json()) as { quota_limits?: Record<string, number> };
    const limits = body.quota_limits ?? null;

    // Update cache
    limitsCache = { limits, fetchedAt: now };
    return limits;
  } catch (err) {
    logger.warn({ err }, "quota-limits fetch failed");
    return limitsCache?.limits ?? null;
  }
}

// ---------------------------------------------------------------------------
// Live usage counting — from the store's own database
// ---------------------------------------------------------------------------

/**
 * Count current live usage of a quota-bounded resource from the store's own DB.
 *
 * Supported resources:
 *  - "products" → count of rows in products table
 *  - "admin_users" → count of users with role='admin'
 *
 * Returns 0 for unknown resources (conservative: allows enforcement to use limit=0 → block).
 */
export async function countLiveUsage(resource: string): Promise<number> {
  const db = getAdminSupabase();

  switch (resource) {
    case "products": {
      const { count, error } = await db
        .from("products")
        .select("*", { count: "exact", head: true });
      if (error) {
        logger.warn({ err: error, resource }, "countLiveUsage: failed to count products");
        return 0;
      }
      return count ?? 0;
    }

    case "admin_users": {
      const { count, error } = await db
        .from("users")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if (error) {
        logger.warn({ err: error, resource }, "countLiveUsage: failed to count admin users");
        return 0;
      }
      return count ?? 0;
    }

    default:
      // Unknown resource — return 0 (with limit 0, creates will be blocked)
      logger.warn({ resource }, "countLiveUsage: unknown resource");
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the quota limits cache (useful in tests).
 */
export function resetQuotaLimitsCache(): void {
  limitsCache = null;
}
