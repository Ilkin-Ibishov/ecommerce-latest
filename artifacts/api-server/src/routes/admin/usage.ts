/**
 * Store-side quota usage endpoint — GET /api/admin/usage
 *
 * Returns each quota's limit + current usage by:
 *  1. Fetching effective limits from the Control_Plane via PLATFORM_QUOTA_URL
 *  2. Counting live data from the store's own DB
 *
 * Guarded by requireAdmin (store admin only).
 *
 * Feature: super-admin-platform
 * Requirements: 15.6, 15.7, 15.10
 */
import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { fetchQuotaLimits, countLiveUsage } from "../../lib/store-hooks/quota-io";
import { queryQuotaUsage, getEffectiveLimit } from "../../lib/store-hooks/quota";

const router: IRouter = Router();

/**
 * The set of quota-bounded resources this store tracks.
 * Extend this array as new quota-bounded resources are added.
 */
const TRACKED_RESOURCES = ["products", "admin_users"] as const;

/**
 * GET /api/admin/usage
 *
 * Returns: { data: { [resource]: { limit: number, usage: number } } }
 *
 * Each resource shows the effective limit (from the assigned plan via
 * Control_Plane) and the current live usage (counted from the store's own DB).
 * Both values are non-negative integers (R15.6).
 */
router.get("/admin/usage", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  // 1. Fetch effective plan limits from the Control_Plane
  const limits = await fetchQuotaLimits();

  // 2. For each tracked resource, count live usage and derive the response
  const usageEntries: Record<string, { limit: number; usage: number }> = {};

  for (const resource of TRACKED_RESOURCES) {
    const effectiveLimit = getEffectiveLimit(limits, resource);
    const currentUsage = await countLiveUsage(resource);
    usageEntries[resource] = queryQuotaUsage(currentUsage, effectiveLimit);
  }

  res.json({ data: usageEntries });
});

export default router;
