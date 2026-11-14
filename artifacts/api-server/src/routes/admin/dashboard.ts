import { Router, type Request, type Response } from "express";
import { getAdminSupabase } from "../../lib/supabase";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";

const router = Router();

// GET /admin/dashboard, /admin/dashboard/metrics, /admin/metrics
// Aggregates online orders AND in-store POS counter sales
router.get(
  ["/admin/dashboard", "/admin/dashboard/metrics", "/admin/metrics"],
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const admin = getAdminSupabase();

    const fromParam = (req.query.from as string) || (req.query.startDate as string) || null;
    const toParam = (req.query.to as string) || (req.query.endDate as string) || null;

    let ordersQuery = (admin as any)
      .from("orders")
      .select("id, status, total_azn, created_at, customer_name, customer_phone")
      .neq("status", "cancelled");

    let counterQuery = (admin as any)
      .from("counter_sales")
      .select("id, sale_number, total_amount, payment_method, created_at, sold_at, status")
      .eq("status", "posted");

    if (fromParam) {
      ordersQuery = ordersQuery.gte("created_at", new Date(fromParam).toISOString());
      counterQuery = counterQuery.gte("created_at", new Date(fromParam).toISOString());
    }
    if (toParam) {
      ordersQuery = ordersQuery.lte("created_at", new Date(toParam).toISOString());
      counterQuery = counterQuery.lte("created_at", new Date(toParam).toISOString());
    }

    const [ordersRes, counterRes] = await Promise.all([
      ordersQuery.order("created_at", { ascending: false }),
      counterQuery.order("created_at", { ascending: false }),
    ]);

    if (ordersRes.error) {
      res.status(500).json({ error: ordersRes.error.message });
      return;
    }
    if (counterRes.error) {
      res.status(500).json({ error: counterRes.error.message });
      return;
    }

    const orders: any[] = ordersRes.data ?? [];
    const counterSales: any[] = counterRes.data ?? [];

    const onlineRevenue = orders.reduce((sum, o) => sum + (Number(o.total_azn) || 0), 0);
    const counterRevenue = counterSales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
    const totalRevenue = Number((onlineRevenue + counterRevenue).toFixed(2));

    const onlineOrders = orders.length;
    const counterOrders = counterSales.length;
    const orderCount = onlineOrders + counterOrders;

    const aov = orderCount > 0 ? Number((totalRevenue / orderCount).toFixed(2)) : 0;

    // Recent combined sales (up to 15 items)
    const combinedRecent = [
      ...orders.map((o) => ({
        id: o.id,
        type: "online" as const,
        identifier: o.id.slice(0, 8).toUpperCase(),
        total_amount: Number(o.total_azn),
        status: o.status,
        customer: o.customer_name || o.customer_phone || "Online Customer",
        created_at: o.created_at,
      })),
      ...counterSales.map((s) => ({
        id: s.id,
        type: "counter" as const,
        identifier: `CS-${s.sale_number}`,
        total_amount: Number(s.total_amount),
        status: s.status,
        customer: `POS (${s.payment_method || "Cash"})`,
        created_at: s.created_at || s.sold_at,
      })),
    ]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 15);

    res.json({
      total_revenue: totalRevenue,
      revenue_total: totalRevenue.toFixed(2),
      order_count: orderCount,
      total_orders: orderCount,
      aov,
      online_revenue: Number(onlineRevenue.toFixed(2)),
      online_orders: onlineOrders,
      counter_revenue: Number(counterRevenue.toFixed(2)),
      counter_orders: counterOrders,
      recent_sales: combinedRecent,
    });
  }
);

export default router;
