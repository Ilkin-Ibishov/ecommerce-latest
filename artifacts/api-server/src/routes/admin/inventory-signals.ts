import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getAdminSupabase } from "../../lib/supabase";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

const lowStockRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string(),
  variant_sku: z.string().nullable(),
  available_quantity: z.number().int(),
  reorder_point: z.number().int(),
  status: z.enum(["out", "low"]),
});
type LowStockRow = z.infer<typeof lowStockRowSchema>;

const deadStockRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string(),
  variant_sku: z.string().nullable(),
  on_hand: z.number().int(),
  days_since_last_sale: z.number().int().nullable(),
  days_since_first_receipt: z.number().int().nullable(),
  unit_cost: z.coerce.number().optional().nullable(),
  capital_tied_up: z.coerce.number().optional().nullable(),
});
type DeadStockRow = z.infer<typeof deadStockRowSchema>;

const reorderSuggestionRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string(),
  variant_sku: z.string().nullable(),
  available_quantity: z.number().int(),
  lead_time_days: z.number().int(),
  daily_velocity: z.coerce.number(),
  reorder_point: z.number().int(),
  recommended_qty: z.number().int(),
  preferred_supplier_name: z.string().nullable(),
  has_enough_data: z.boolean(),
});
type ReorderSuggestionRow = z.infer<typeof reorderSuggestionRowSchema>;

interface SignalsRpcClient {
  rpc(
    fn: "get_low_stock_signals",
    args: { p_search: string | null; p_status: string | null }
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "get_dead_stock_signals",
    args: { p_days: number }
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "get_reorder_suggestions",
    args: { p_window_days: number; p_target_days: number; p_min_sales: number }
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

function getSignalsClient(admin: unknown): SignalsRpcClient {
  return admin as unknown as SignalsRpcClient;
}

// GET /admin/inventory/signals/summary — Dashboard counts
router.get("/admin/inventory/signals/summary", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const isAdmin = req.userRole === "admin";
  const client = getSignalsClient(admin);

  const [lowRes, deadRes, reorderRes] = await Promise.all([
    client.rpc("get_low_stock_signals", { p_search: null, p_status: null }),
    client.rpc("get_dead_stock_signals", { p_days: 90 }),
    isAdmin
      ? client.rpc("get_reorder_suggestions", { p_window_days: 28, p_target_days: 60, p_min_sales: 3 })
      : Promise.resolve({ data: [] as unknown, error: null }),
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

  const lowRows = z.array(lowStockRowSchema).parse(lowRes.data ?? []);
  const deadRows = z.array(deadStockRowSchema).parse(deadRes.data ?? []);
  const reorderRows = isAdmin ? z.array(reorderSuggestionRowSchema).parse(reorderRes.data ?? []) : null;

  res.json({
    low_stock_count: lowRows.length,
    out_of_stock_count: lowRows.filter((r) => r.status === "out").length,
    dead_stock_count: deadRows.length,
    reorder_suggestions_count: reorderRows ? reorderRows.filter((r) => r.has_enough_data).length : null,
  });
});

// GET /admin/inventory/signals/low-stock — Low & out of stock list
router.get("/admin/inventory/signals/low-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const status = typeof req.query.status === "string" && ["out", "low"].includes(req.query.status) ? req.query.status : null;

  const { data, error } = await getSignalsClient(admin).rpc("get_low_stock_signals", { p_search: search, p_status: status });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = z.array(lowStockRowSchema).parse(data ?? []);
  res.json({ variants: rows, count: rows.length });
});

// GET /admin/inventory/signals/dead-stock — Dead stock list (cost stripped for staff)
router.get("/admin/inventory/signals/dead-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const days = Math.max(1, parseInt(String(req.query.days || "90"), 10) || 90);
  const isAdmin = req.userRole === "admin";

  const { data, error } = await getSignalsClient(admin).rpc("get_dead_stock_signals", { p_days: days });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rawRows = z.array(deadStockRowSchema).parse(data ?? []);
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

  const { data, error } = await getSignalsClient(admin).rpc("get_reorder_suggestions", {
    p_window_days: windowDays,
    p_target_days: targetDays,
    p_min_sales: minSales,
  });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const suggestions = z.array(reorderSuggestionRowSchema).parse(data ?? []);
  res.json({ suggestions, count: suggestions.length });
});

export default router;
