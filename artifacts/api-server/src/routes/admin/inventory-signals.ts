import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getAdminSupabase } from "../../lib/supabase";
import { requireStaffOrAdmin } from "../../middlewares/requireStaffOrAdmin";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { logger } from "../../lib/logger";

const router = Router();

const lowStockRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string().nullable(),
  variant_sku: z.string().nullable(),
  barcode: z.string().nullable(),
  unit_of_measure: z.string().nullable(),
  on_hand: z.coerce.number(),
  reserved_quantity: z.coerce.number(),
  available_quantity: z.coerce.number(),
  threshold: z.coerce.number(),
  status: z.enum(["out", "low"]),
});
type LowStockRow = z.infer<typeof lowStockRowSchema>;

const deadStockRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string().nullable(),
  variant_sku: z.string().nullable(),
  barcode: z.string().nullable(),
  unit_of_measure: z.string().nullable(),
  on_hand: z.coerce.number(),
  days_since_last_sale: z.number().int().nullable(),
  days_since_first_receipt: z.number().int().nullable(),
  unit_cost: z.coerce.number().optional().nullable(),
  capital_tied_up: z.coerce.number().optional().nullable(),
});
type DeadStockRow = z.infer<typeof deadStockRowSchema>;

const reorderSuggestionRowSchema = z.object({
  variant_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_title: z.string().nullable(),
  variant_sku: z.string().nullable(),
  barcode: z.string().nullable(),
  unit_of_measure: z.string().nullable(),
  supplier_id: z.string().uuid().nullable(),
  supplier_name: z.string().nullable(),
  supplier_contact: z.string().nullable(),
  on_hand: z.coerce.number(),
  reserved_quantity: z.coerce.number(),
  available_quantity: z.coerce.number(),
  units_sold_window: z.coerce.number(),
  sales_count: z.number().int(),
  velocity: z.coerce.number(),
  days_of_cover: z.coerce.number().nullable(),
  suggested_qty: z.coerce.number().nullable(),
  has_enough_data: z.boolean(),
});
type ReorderSuggestionRow = z.infer<typeof reorderSuggestionRowSchema>;

const availabilityRowSchema = z.object({
  product_id: z.string().uuid(),
  on_hand: z.coerce.number(),
  reserved_quantity: z.coerce.number(),
  available_quantity: z.coerce.number().nullable(),
  deficit_quantity: z.coerce.number(),
});
type AvailabilityRow = z.infer<typeof availabilityRowSchema>;

type RpcResult = { data: unknown; error: { message: string } | null };
interface FilterableRpc extends PromiseLike<RpcResult> {
  in(column: "variant_id", values: string[]): PromiseLike<RpcResult>;
}

interface SignalsRpcClient {
  rpc(fn: "get_low_stock_signals", args: { p_search: string | null; p_status: string | null }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(fn: "get_dead_stock_signals", args: { p_days: number }): FilterableRpc;
  rpc(fn: "get_reorder_suggestions", args: { p_window_days: number; p_target_days: number; p_min_sales: number }): Promise<{ data: unknown; error: { message: string } | null }>;
}

function getSignalsClient(admin: unknown): SignalsRpcClient {
  return admin as unknown as SignalsRpcClient;
}

function parseSignals<T>(req: Request, res: Response, schema: z.ZodType<T>, data: unknown, label: string): T | null {
  const parsed = schema.safeParse(data ?? []);
  if (!parsed.success) {
    (req.log || logger).error({ issues: parsed.error.issues }, `Failed to parse ${label}`);
    res.status(500).json({ error: "Failed to parse inventory signals data" });
    return null;
  }
  return parsed.data;
}

export interface SignalSettings {
  deadStockDays: number;
  reorderTargetDays: number;
  reorderWindowDays: number;
  reorderMinSales: number;
}

const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  deadStockDays: 90,
  reorderTargetDays: 60,
  reorderWindowDays: 28,
  reorderMinSales: 3,
};

function parsePositiveIntSetting(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 ? num : defaultValue;
}

export function parseSignalSettings(rows: { key: string; value: string }[]): SignalSettings {
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }

  return {
    deadStockDays: parsePositiveIntSetting(map.get("dead_stock_days"), DEFAULT_SIGNAL_SETTINGS.deadStockDays),
    reorderTargetDays: parsePositiveIntSetting(map.get("reorder_target_days"), DEFAULT_SIGNAL_SETTINGS.reorderTargetDays),
    reorderWindowDays: parsePositiveIntSetting(map.get("reorder_velocity_window_days"), DEFAULT_SIGNAL_SETTINGS.reorderWindowDays),
    reorderMinSales: parsePositiveIntSetting(map.get("reorder_min_sales"), DEFAULT_SIGNAL_SETTINGS.reorderMinSales),
  };
}

function parseQueryPositiveInt(param: unknown): number | null {
  if (typeof param !== "string") return null;
  const num = Number(param);
  return Number.isInteger(num) && num >= 1 ? num : null;
}

// Comma-separated variant uuids, at most 100.
const variantIdsQuerySchema = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(z.string().uuid()).min(1).max(100));

async function getSignalSettings(req: Request): Promise<SignalSettings> {
  try {
    const admin = getAdminSupabase();
    const { data, error } = await admin
      .from("store_settings")
      .select("key, value")
      .in("key", [
        "dead_stock_days",
        "reorder_target_days",
        "reorder_velocity_window_days",
        "reorder_min_sales",
      ]);

    if (error) {
      (req.log || logger).error({ error: error.message }, "Failed to fetch store_settings for inventory signals");
      return parseSignalSettings([]);
    }

    return parseSignalSettings((data ?? []) as { key: string; value: string }[]);
  } catch (err) {
    (req.log || logger).error({ err }, "Exception fetching store_settings for inventory signals");
    return parseSignalSettings([]);
  }
}

// GET /admin/inventory/signals/summary — Dashboard counts
router.get("/admin/inventory/signals/summary", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const isAdmin = req.userRole === "admin";
  const client = getSignalsClient(admin);
  const settings = await getSignalSettings(req);

  const [lowRes, deadRes, reorderRes] = await Promise.all([
    client.rpc("get_low_stock_signals", { p_search: null, p_status: null }),
    client.rpc("get_dead_stock_signals", { p_days: settings.deadStockDays }),
    isAdmin
      ? client.rpc("get_reorder_suggestions", {
          p_window_days: settings.reorderWindowDays,
          p_target_days: settings.reorderTargetDays,
          p_min_sales: settings.reorderMinSales,
        })
      : Promise.resolve({ data: [] as unknown, error: null }),
  ]);

  if (lowRes.error) { res.status(500).json({ error: lowRes.error.message }); return; }
  if (deadRes.error) { res.status(500).json({ error: deadRes.error.message }); return; }
  if (reorderRes.error) { res.status(500).json({ error: reorderRes.error.message }); return; }

  const lowRows = parseSignals(req, res, z.array(lowStockRowSchema), lowRes.data, "low stock signals");
  if (!lowRows) return;

  const deadRows = parseSignals(req, res, z.array(deadStockRowSchema), deadRes.data, "dead stock signals");
  if (!deadRows) return;

  let reorderRows: ReorderSuggestionRow[] | null = null;
  if (isAdmin) {
    reorderRows = parseSignals(req, res, z.array(reorderSuggestionRowSchema), reorderRes.data, "reorder suggestions");
    if (!reorderRows) return;
  }

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

  const rows = parseSignals(req, res, z.array(lowStockRowSchema), data, "low stock signals");
  if (!rows) return;

  res.json({ variants: rows, count: rows.length });
});

// GET /admin/inventory/signals/dead-stock — Dead stock list (cost stripped for staff)
router.get("/admin/inventory/signals/dead-stock", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const settings = await getSignalSettings(req);
  const days = parseQueryPositiveInt(req.query.days) ?? settings.deadStockDays;
  const isAdmin = req.userRole === "admin";

  let variantIds: string[] | null = null;
  if (req.query.variant_ids !== undefined) {
    const parsedIds = variantIdsQuerySchema.safeParse(req.query.variant_ids);
    if (!parsedIds.success) {
      res.status(400).json({ error: "invalid_variant_ids" });
      return;
    }
    variantIds = parsedIds.data;
  }

  const query = getSignalsClient(admin).rpc("get_dead_stock_signals", { p_days: days });
  const { data, error } = await (variantIds ? query.in("variant_id", variantIds) : query);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rawRows = parseSignals(req, res, z.array(deadStockRowSchema), data, "dead stock signals");
  if (!rawRows) return;

  if (isAdmin) {
    const totalCapital = rawRows.reduce((sum, r) => sum + Number(r.capital_tied_up || 0), 0);
    res.json({
      days,
      variants: rawRows,
      count: rawRows.length,
      total_dead_capital: Math.round(totalCapital * 100) / 100,
    });
    return;
  }

  // Staff role: strictly strip unit_cost and capital_tied_up (M2a RLS boundary)
  const staffRows = rawRows.map(({ unit_cost, capital_tied_up, ...rest }) => rest);
  res.json({ days, variants: staffRows, count: staffRows.length });
});

// GET /admin/inventory/signals/reorder — Reorder suggestions (owner-only)
router.get("/admin/inventory/signals/reorder", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const settings = await getSignalSettings(req);
  const windowDays = parseQueryPositiveInt(req.query.windowDays) ?? settings.reorderWindowDays;
  const targetDays = parseQueryPositiveInt(req.query.targetDays) ?? settings.reorderTargetDays;
  const minSales = parseQueryPositiveInt(req.query.minSales) ?? settings.reorderMinSales;

  const { data, error } = await getSignalsClient(admin).rpc("get_reorder_suggestions", {
    p_window_days: windowDays,
    p_target_days: targetDays,
    p_min_sales: minSales,
  });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const suggestions = parseSignals(req, res, z.array(reorderSuggestionRowSchema), data, "reorder suggestions");
  if (!suggestions) return;

  res.json({ suggestions, count: suggestions.length });
});

// GET /admin/inventory/availability — Aggregate variant availability for inventory overview
router.get("/admin/inventory/availability", requireStaffOrAdmin, async (req: Request, res: Response): Promise<void> => {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("product_variant_availability")
    .select("product_id, on_hand, reserved_quantity, available_quantity, deficit_quantity");

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = parseSignals(req, res, z.array(availabilityRowSchema), data, "variant availability");
  if (!rows) return;

  res.json({ rows });
});

export default router;
