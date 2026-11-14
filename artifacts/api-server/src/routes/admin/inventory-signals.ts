import { Router, type Request, type Response } from "express";
import { getAdminSupabase } from "../../lib/supabase";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

// GET /admin/inventory/signals/summary — Dashboard counts
router.get("/admin/inventory/signals/summary", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const isAdmin = req.userRole === "admin";

  const [lowRes, deadRes, reorderRes] = await Promise.all([
    (admin as any).rpc("get_low_stock_signals", { p_search: null, p_status: null }),
    (admin as any).rpc("get_dead_stock_signals", { p_days: 90 }),
    isAdmin ? (admin as any).rpc("get_reorder_suggestions", { p_window_days: 28, p_target_days: 60, p_min_sales: 3 }) : Promise.resolve({ data: [] }),
  ]);

  if (lowRes.error) {
    res.status(500).json({ error: lowRes.error.message });
    return;
  }
  if (deadRes.error) {
    res.status(500).json({ error: deadRes.error.message });
    return;
  }
  if (reorderRes.error) {
    res.status(500).json({ error: reorderRes.error.message });
    return;
  }

  res.json({
    low_stock_count: (lowRes.data ?? []).length,
    out_of_stock_count: (lowRes.data ?? []).filter((r: any) => r.status === "out").length,
    dead_stock_count: (deadRes.data ?? []).length,
    reorder_suggestions_count: isAdmin ? (reorderRes.data ?? []).filter((r: any) => r.has_enough_data).length : null,
  });
});

// GET /admin/inventory/signals/low-stock — Low & out of stock list
router.get("/admin/inventory/signals/low-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const status = typeof req.query.status === "string" && ["out", "low"].includes(req.query.status) ? req.query.status : null;

  const { data, error } = await (admin as any).rpc("get_low_stock_signals", { p_search: search, p_status: status });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ variants: data ?? [], count: (data ?? []).length });
});

// GET /admin/inventory/signals/dead-stock — Dead stock list (cost stripped for staff)
router.get("/admin/inventory/signals/dead-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const days = Math.max(1, parseInt(String(req.query.days || "90"), 10) || 90);
  const isAdmin = req.userRole === "admin";

  const { data, error } = await (admin as any).rpc("get_dead_stock_signals", { p_days: days });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rawRows: any[] = data ?? [];
  if (isAdmin) {
    const totalCapital = rawRows.reduce((sum, r) => sum + Number(r.capital_tied_up || 0), 0);
    res.json({
      variants: rawRows,
      count: rawRows.length,
      total_dead_capital: Math.round(totalCapital * 100) / 100,
    });
    return;
  }

  // Staff role: strictly strip unit_cost and capital_tied_up (M2a RLS boundary)
  const staffRows = rawRows.map(({ unit_cost, capital_tied_up, ...rest }) => rest);
  res.json({ variants: staffRows, count: staffRows.length });
});

// GET /admin/inventory/signals/reorder — Reorder suggestions (owner-only)
router.get("/admin/inventory/signals/reorder", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const windowDays = Math.max(1, parseInt(String(req.query.windowDays || "28"), 10) || 28);
  const targetDays = Math.max(1, parseInt(String(req.query.targetDays || "60"), 10) || 60);
  const minSales = Math.max(1, parseInt(String(req.query.minSales || "3"), 10) || 3);

  const { data, error } = await (admin as any).rpc("get_reorder_suggestions", {
    p_window_days: windowDays,
    p_target_days: targetDays,
    p_min_sales: minSales,
  });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ suggestions: data ?? [], count: (data ?? []).length });
});

export default router;
