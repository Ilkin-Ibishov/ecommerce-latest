/**
 * Store_Metrics_Endpoint — aggregate-only shaper.
 *
 * This is the store-side endpoint that the Control_Plane polls to obtain
 * aggregate numbers about this Store. It returns ONLY aggregate fields
 * (order_count, revenue_total, traffic_count, quota_usage, range) and
 * never raw records (no individual orders, customers, or products).
 *
 * Guarded by Per_Store_Credential verification using the pure
 * `verifyStoreCredential()` from `lib/store-hooks/credential.ts`.
 *
 * Feature: super-admin-platform
 * Requirements: 9.4, 9.5, 2.3
 */
import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { verifyStoreCredential } from "../lib/store-hooks/credential";
import { getAdminSupabase } from "../lib/supabase";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/store-metrics
// ---------------------------------------------------------------------------

router.get(
  "/store-metrics",
  async (req: Request, res: Response): Promise<void> => {
    // --- Per_Store_Credential verification ---
    const headerStoreId = req.headers["x-store-id"] as string | undefined;
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    const expectedStoreId = process.env.STORE_ID ?? "";
    const expectedSecret = process.env.STORE_PLATFORM_SECRET ?? "";

    const result = verifyStoreCredential({
      headerStoreId,
      bearerToken,
      expectedStoreId,
      expectedSecret,
    });

    if (!result.valid) {
      res.status(result.httpStatus).json({ error: result.error });
      return;
    }

    // --- Parse query params ---
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!from || !to) {
      res.status(400).json({ error: "from and to query parameters are required" });
      return;
    }

    // Validate ISO date format
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      res.status(400).json({ error: "from and to must be valid ISO dates" });
      return;
    }

    if (fromDate > toDate) {
      res.status(400).json({ error: "from must not be after to" });
      return;
    }

    // --- Compute aggregates from the Store's own DB ---
    const db = getAdminSupabase();

    // order_count: count of orders where created_at is between from and to (inclusive)
    const { count: orderCount, error: orderCountError } = await db
      .from("orders")
      .select("*", { count: "exact", head: true })
      .gte("created_at", from)
      .lte("created_at", to);

    if (orderCountError) {
      req.log.error({ err: orderCountError }, "Failed to count orders");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // revenue_total: sum of orders.total_azn for same range
    const { data: revenueRows, error: revenueError } = await db
      .from("orders")
      .select("total_azn")
      .gte("created_at", from)
      .lte("created_at", to);

    if (revenueError) {
      req.log.error({ err: revenueError }, "Failed to fetch order totals");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const revenueSum = (revenueRows ?? []).reduce(
      (acc, row) => acc + (Number(row.total_azn) || 0),
      0,
    );
    const revenueTotal = revenueSum.toFixed(2);

    // traffic_count: null (optional, not implemented yet)
    const trafficCount: number | null = null;

    // quota_usage: { products: count of products, admin_users: count of users where role='admin' }
    const { count: productCount, error: productCountError } = await db
      .from("products")
      .select("*", { count: "exact", head: true });

    if (productCountError) {
      req.log.error({ err: productCountError }, "Failed to count products");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const { count: adminUserCount, error: adminUserCountError } = await db
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");

    if (adminUserCountError) {
      req.log.error({ err: adminUserCountError }, "Failed to count admin users");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // --- Return ONLY aggregate fields — no raw records ---
    res.json({
      order_count: orderCount ?? 0,
      revenue_total: revenueTotal,
      traffic_count: trafficCount,
      quota_usage: {
        products: productCount ?? 0,
        admin_users: adminUserCount ?? 0,
      },
      range: { from, to },
    });
  },
);

export default router;
