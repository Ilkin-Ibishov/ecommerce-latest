import { Router, type Request, type Response } from "express";
import { getAdminSupabase } from "../../lib/supabase";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

// GET /admin/reports/margins and /admin/margins (Owner-Only)
router.get(["/admin/reports/margins", "/admin/margins"], requireAdmin, async (req: Request, res: Response) => {
  const admin = getAdminSupabase();
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : (typeof req.query.from === "string" ? req.query.from : null);
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : (typeof req.query.to === "string" ? req.query.to : null);
  const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId.trim() 
    ? req.query.categoryId 
    : (typeof req.query.category_id === "string" && req.query.category_id.trim() ? req.query.category_id : null);

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate query parameters are required" });
  }

  const { data: rows, error } = await (admin as any).rpc("get_margin_report", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_category_id: categoryId,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const variants = (rows ?? []).map((r: any) => ({
    variant_id: r.variant_id,
    sku: r.sku ?? null,
    product_id: r.product_id,
    product_title: r.product_title,
    category_id: r.category_id ?? null,
    category_name: r.category_name ?? null,
    revenue: Number(r.revenue ?? 0),
    cogs: Number(r.cogs ?? 0),
    gross_margin: Number(r.gross_margin ?? 0),
    margin_percent: Number(r.margin_percent ?? 0),
    units_sold: Number(r.units_sold ?? 0),
    unpriced_units_out: Number(r.unpriced_units_out ?? 0),
  }));

  // Aggregate by category
  const categoryMap = new Map<string, {
    category_id: string | null;
    category_name: string;
    revenue: number;
    cogs: number;
    gross_margin: number;
    margin_percent: number;
    units_sold: number;
    unpriced_units_out: number;
  }>();

  let totalRev = 0;
  let totalCogs = 0;
  let totalUnits = 0;
  let totalUnpricedUnits = 0;

  for (const v of variants) {
    totalRev += v.revenue;
    totalCogs += v.cogs;
    totalUnits += v.units_sold;
    totalUnpricedUnits += v.unpriced_units_out;

    const catName = v.category_name ?? "Uncategorized";
    const cur = categoryMap.get(catName) ?? {
      category_id: v.category_id,
      category_name: catName,
      revenue: 0,
      cogs: 0,
      gross_margin: 0,
      margin_percent: 0,
      units_sold: 0,
      unpriced_units_out: 0,
    };
    cur.revenue = Number((cur.revenue + v.revenue).toFixed(2));
    cur.cogs = Number((cur.cogs + v.cogs).toFixed(2));
    cur.units_sold += v.units_sold;
    cur.unpriced_units_out += v.unpriced_units_out;
    cur.gross_margin = Number((cur.revenue - cur.cogs).toFixed(2));
    cur.margin_percent = cur.revenue > 0 ? Number(((cur.gross_margin / cur.revenue) * 100).toFixed(2)) : 0;
    categoryMap.set(catName, cur);
  }

  const categories = Array.from(categoryMap.values()).sort((a, b) => b.gross_margin - a.gross_margin);
  const totalMargin = Number((totalRev - totalCogs).toFixed(2));
  const totalMarginPercent = totalRev > 0 ? Number(((totalMargin / totalRev) * 100).toFixed(2)) : 0;

  // Best and worst contributors by absolute margin
  const sortedByMarginDesc = [...variants].sort((a, b) => b.gross_margin - a.gross_margin);
  const bestContributors = sortedByMarginDesc.slice(0, 5);
  const worstContributors = [...variants].sort((a, b) => a.gross_margin - b.gross_margin).slice(0, 5);

  return res.json({
    start_date: startDate,
    end_date: endDate,
    total_revenue: Number(totalRev.toFixed(2)),
    total_cogs: Number(totalCogs.toFixed(2)),
    total_gross_margin: totalMargin,
    total_margin_percent: totalMarginPercent,
    total_units_sold: totalUnits,
    total_unpriced_units: totalUnpricedUnits,
    unpriced_units_out: totalUnpricedUnits,
    variants,
    categories,
    best_contributors: bestContributors,
    worst_contributors: worstContributors,
    top_contributors: bestContributors.map((b) => ({
      id: b.variant_id,
      title: b.product_title + (b.sku ? ` (${b.sku})` : ""),
      sku: b.sku,
      margin: b.gross_margin,
      margin_percent: b.margin_percent,
      revenue: b.revenue,
      cogs: b.cogs,
      units_sold: b.units_sold,
      unpriced_units_out: b.unpriced_units_out,
    })),
    bottom_contributors: worstContributors.map((w) => ({
      id: w.variant_id,
      title: w.product_title + (w.sku ? ` (${w.sku})` : ""),
      sku: w.sku,
      margin: w.gross_margin,
      margin_percent: w.margin_percent,
      revenue: w.revenue,
      cogs: w.cogs,
      units_sold: w.units_sold,
      unpriced_units_out: w.unpriced_units_out,
    })),
    kpis: {
      revenue: Number(totalRev.toFixed(2)),
      cogs: Number(totalCogs.toFixed(2)),
      gross_margin: totalMargin,
      margin_percent: totalMarginPercent,
      units_sold: totalUnits,
      unpriced_units_out: totalUnpricedUnits,
    },
  });
});

export default router;
