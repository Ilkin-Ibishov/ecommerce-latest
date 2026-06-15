/**
 * enforceQuota middleware factory — guards quota-bounded create routes.
 *
 * Checks current usage vs limit using claimQuota() from lib/store-hooks/quota.ts,
 * rejects with 403 on exceeded. Fetches effective limits from the Control_Plane
 * via env-configured PLATFORM_QUOTA_URL, counts live data from the store's own DB.
 *
 * Usage:
 *   router.post("/admin/products", requireAdmin, enforceQuota("products"), ...handler);
 *
 * Feature: super-admin-platform
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.9, 15.11, 15.12
 */
import type { Request, Response, NextFunction } from "express";
import { claimQuota, getEffectiveLimit } from "../lib/store-hooks/quota";
import { fetchQuotaLimits, countLiveUsage } from "../lib/store-hooks/quota-io";
import { logger } from "../lib/logger";

/**
 * Factory: returns an Express middleware that enforces plan-based quota for the
 * given resource name.
 *
 * The middleware:
 *  1. Fetches effective plan limits from the Control_Plane (cached, with fallback to 0)
 *  2. Counts the store's current live usage from its own DB
 *  3. Calls claimQuota() to decide: allowed → next(), rejected → 403
 *
 * @param resource - The quota-bounded resource name (e.g. "products", "admin_users")
 * @param requested - Number of items being created (defaults to 1)
 */
export function enforceQuota(resource: string, requested = 1) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Fetch effective limits from Control_Plane
      const limits = await fetchQuotaLimits();
      const limit = getEffectiveLimit(limits, resource);

      // 2. Count current live usage from store's own DB
      const currentUsage = await countLiveUsage(resource);

      // 3. Decide using pure claimQuota logic
      const result = claimQuota({ currentUsage, limit, requested });

      if (result.allowed) {
        next();
        return;
      }

      // Rejected — 403 with quota error
      res.status(result.httpStatus).json({ error: result.error });
    } catch (err) {
      // If quota check fails unexpectedly, log and allow through (fail-open for availability)
      // This matches the fail-safe-to-active philosophy for store-side hooks
      logger.warn({ err, resource }, "enforceQuota: unexpected error, allowing request through");
      next();
    }
  };
}
