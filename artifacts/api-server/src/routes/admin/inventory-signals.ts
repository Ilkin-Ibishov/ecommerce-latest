import { Router, type Request, type Response } from "express";
import { getAdminSupabase } from "../../lib/supabase";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { queueNotification } from "../../lib/notifications";
import {
  fetchLowStockFallback,
  fetchDeadStockFallback,
} from "../../lib/inventory-signals-low-dead";
import { fetchReorderFallback } from "../../lib/inventory-signals-reorder";

const router = Router();

async function getLowStock(admin: any, search?: string | null, status?: string | null) {
  try {
    const { data, error } = await (admin as any).rpc("get_low_stock_signals", {
      p_search: search ?? null,
      p_status: status ?? null,
    });
    if (!error && Array.isArray(data)) return data;
  } catch {}
  return fetchLowStockFallback(admin, search, status);
}

async function getDeadStock(admin: any, days: number = 90) {
  try {
    const { data, error } = await (admin as any).rpc("get_dead_stock_signals", { p_days: days });
    if (!error && Array.isArray(data)) return data;
  } catch {}
  return fetchDeadStockFallback(admin, days);
}

async function getReorder(admin: any, windowDays: number, targetDays: number, minSales: number) {
  try {
    const { data, error } = await (admin as any).rpc("get_reorder_suggestions", {
      p_window_days: windowDays,
      p_target_days: targetDays,
      p_min_sales: minSales,
    });
    if (!error && Array.isArray(data)) return data;
  } catch {}
  return fetchReorderFallback(admin, windowDays, targetDays, minSales);
}

// GET /admin/inventory/signals/summary — Dashboard counts
router.get("/admin/inventory/signals/summary", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const isAdmin = req.userRole === "admin";

  const [lowData, deadData, reorderData] = await Promise.all([
    getLowStock(admin, null, null),
    getDeadStock(admin, 90),
    isAdmin ? getReorder(admin, 28, 60, 3) : Promise.resolve([]),
  ]);

  res.json({
    low_stock_count: lowData.length,
    out_of_stock_count: lowData.filter((r: any) => r.status === "out").length,
    dead_stock_count: deadData.length,
    reorder_suggestions_count: isAdmin ? reorderData.filter((r: any) => r.has_enough_data).length : null,
  });
});

// GET /admin/inventory/signals/low-stock — Low & out of stock list
router.get("/admin/inventory/signals/low-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const status = typeof req.query.status === "string" && ["out", "low"].includes(req.query.status) ? req.query.status : null;

  const data = await getLowStock(admin, search, status);
  res.json({ variants: data, count: data.length });
});

// GET /admin/inventory/signals/dead-stock — Dead stock list (cost stripped for staff)
router.get("/admin/inventory/signals/dead-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const days = Math.max(1, parseInt(String(req.query.days || "90"), 10) || 90);
  const isAdmin = req.userRole === "admin";

  const rawRows = await getDeadStock(admin, days);

  if (isAdmin) {
    const totalCapital = rawRows.reduce((sum: number, r: any) => sum + Number(r.capital_tied_up || 0), 0);
    res.json({
      variants: rawRows,
      count: rawRows.length,
      total_dead_capital: Math.round(totalCapital * 100) / 100,
    });
    return;
  }

  // Staff role: strictly strip unit_cost and capital_tied_up (M2a RLS boundary)
  const staffRows = rawRows.map(({ unit_cost, capital_tied_up, ...rest }: any) => rest);
  res.json({ variants: staffRows, count: staffRows.length });
});

// GET /admin/inventory/signals/reorder — Reorder suggestions (owner-only)
router.get("/admin/inventory/signals/reorder", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const windowDays = Math.max(1, parseInt(String(req.query.windowDays || req.query.window_days || "28"), 10) || 28);
  const targetDays = Math.max(1, parseInt(String(req.query.targetDays || req.query.target_days || "60"), 10) || 60);
  const minSales = Math.max(1, parseInt(String(req.query.minSales || req.query.min_sales || "3"), 10) || 3);

  const data = await getReorder(admin, windowDays, targetDays, minSales);
  res.json({ suggestions: data, count: data.length });
});

// POST /admin/inventory/signals/evaluate-digest — Trigger low-stock digest evaluation
router.post("/admin/inventory/signals/evaluate-digest", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();

  const lowVariants = await getLowStock(admin, null, null);

  const activeLow: any[] = lowVariants ?? [];
  const lowIds = new Set(activeLow.map((v) => v.variant_id));

  // 1. Clear suppression for recovered variants (available > threshold)
  const { data: existingEvents } = await (admin as any).from("low_stock_notification_events").select("variant_id");
  const existingIds: string[] = (existingEvents ?? []).map((e: any) => e.variant_id);
  const recoveredIds = existingIds.filter((id: string) => !lowIds.has(id));
  if (recoveredIds.length > 0) {
    await (admin as any).from("low_stock_notification_events").delete().in("variant_id", recoveredIds);
  }

  // 2. Identify newly low variants not yet suppressed
  const existingIdSet = new Set(existingIds.filter((id: string) => lowIds.has(id)));
  const newlyLow = activeLow.filter((v) => !existingIdSet.has(v.variant_id));

  if (newlyLow.length === 0) {
    res.json({ evaluated: true, notified_count: 0, newly_low_count: 0 });
    return;
  }

  // 3. Record suppression events
  const now = new Date().toISOString();
  await (admin as any).from("low_stock_notification_events").insert(
    newlyLow.map((v) => ({
      variant_id: v.variant_id,
      notified_at: now,
      last_notified_available: v.available_quantity,
      threshold_at_notification: v.threshold,
    }))
  );

  // 4. Dispatch single consolidated digest
  await queueNotification({
    type: "low_stock",
    channel: "in_app",
    recipient: "admin",
    payload: {
      count: newlyLow.length,
      items: newlyLow.map((v) => ({
        variant_id: v.variant_id,
        sku: v.variant_sku,
        title: v.product_title,
        available: v.available_quantity,
        threshold: v.threshold,
      })),
    },
  });

  res.json({ evaluated: true, notified_count: newlyLow.length });
});

export default router;
