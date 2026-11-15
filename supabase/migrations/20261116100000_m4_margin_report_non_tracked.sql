-- Migration: include non-tracked sales in get_margin_report
--
-- Replaces get_margin_report to account for non-tracked sales (counter sales
-- and orders) that write no stock_movements rows since M4.
-- Non-tracked lines are included with COGS = 0 and revenue = net line total.

CREATE OR REPLACE FUNCTION public.get_margin_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_category_id uuid DEFAULT NULL
)
RETURNS TABLE (
  variant_id          uuid,
  sku                 text,
  product_id          uuid,
  product_title       text,
  category_id         uuid,
  category_name       text,
  revenue             numeric,
  cogs                numeric,
  gross_margin        numeric,
  margin_percent      numeric,
  units_sold          numeric,
  unpriced_units_out  numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH movement_sales AS (
    SELECT
      sm.id AS movement_id, sm.variant_id, sm.quantity_delta, sm.reason,
      sm.reference_type, sm.reference_id, sm.transaction_id,
      smc.total_cost AS cogs_total
    FROM public.stock_movements sm
    JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
    WHERE sm.posting_date >= p_start_date AND sm.posting_date < p_end_date
      AND sm.reason IN ('online_sale', 'counter_sale', 'customer_return')
  ),
  order_variant_unit_prices AS (
    SELECT oi.order_id, oi.variant_id,
           SUM(oi.line_total)::numeric / NULLIF(SUM(oi.quantity), 0) AS weighted_unit_price
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelled', 'refused_at_delivery')
    GROUP BY oi.order_id, oi.variant_id
  ),
  counter_line_prices AS (
    SELECT l.sale_id, l.variant_id, SUM(l.net_line_total) AS net_total, SUM(l.quantity) AS qty
    FROM public.counter_sale_lines l
    JOIN public.counter_sales cs ON cs.id = l.sale_id AND cs.status IN ('posted', 'voided')
    GROUP BY l.sale_id, l.variant_id
  ),
  movement_revenue AS (
    SELECT
      ms.variant_id, ms.quantity_delta, ms.reason, ms.cogs_total,
      (ms.reference_type IN ('counter_sale', 'reservation')) AS is_signed,
      CASE
        WHEN ms.reference_type = 'order' THEN ovup.weighted_unit_price IS NOT NULL
        WHEN ms.reference_type = 'counter_sale' THEN clp.qty IS NOT NULL
        WHEN ms.reference_type = 'reservation' THEN r.id IS NOT NULL
        ELSE false
      END AS is_priced,
      CASE
        WHEN ms.reason IN ('online_sale', 'counter_sale') AND ms.reference_type = 'order' THEN
          COALESCE(ovup.weighted_unit_price * ABS(ms.quantity_delta), 0)
        WHEN ms.reason = 'customer_return' AND ms.reference_type = 'order' THEN
          -COALESCE(ovup.weighted_unit_price * ABS(ms.quantity_delta), 0)
        WHEN ms.reference_type = 'counter_sale' THEN
          COALESCE(ROUND(-ms.quantity_delta * clp.net_total / NULLIF(clp.qty, 0), 2), 0)
        WHEN ms.reference_type = 'reservation' THEN
          COALESCE(SIGN(-ms.quantity_delta) * r.agreed_price, 0)
        ELSE 0
      END AS revenue_amount
    FROM movement_sales ms
    LEFT JOIN order_variant_unit_prices ovup
      ON ovup.order_id = CASE WHEN ms.reference_type = 'order' THEN ms.reference_id::uuid END
     AND ovup.variant_id = ms.variant_id
    LEFT JOIN counter_line_prices clp
      ON ms.reference_type = 'counter_sale'
     AND clp.sale_id = ms.transaction_id
     AND clp.variant_id = ms.variant_id
    LEFT JOIN public.reservations r
      ON r.id = CASE WHEN ms.reference_type = 'reservation' THEN ms.reference_id::uuid END
  ),
  non_tracked_lines AS (
    SELECT
      l.variant_id,
      l.quantity::numeric AS units,
      l.net_line_total::numeric AS revenue
    FROM public.counter_sale_lines l
    JOIN public.counter_sales cs ON cs.id = l.sale_id
    JOIN public.product_variants pv ON pv.id = l.variant_id
    WHERE cs.status = 'posted'
      AND cs.posting_date >= p_start_date AND cs.posting_date < p_end_date
      AND pv.track_stock = false
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.transaction_id = cs.id
          AND sm.variant_id = l.variant_id
      )
    UNION ALL
    SELECT
      oi.variant_id,
      oi.quantity::numeric AS units,
      oi.line_total::numeric AS revenue
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.product_variants pv ON pv.id = oi.variant_id
    WHERE o.status NOT IN ('cancelled', 'refused_at_delivery')
      AND o.created_at >= p_start_date AND o.created_at < p_end_date
      AND pv.track_stock = false
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.reference_type = 'order'
          AND sm.reference_id = o.id::text
          AND sm.variant_id = oi.variant_id
      )
  ),
  aggregated_metrics AS (
    SELECT
      combined.variant_id,
      SUM(combined.net_units_sold) AS net_units_sold,
      SUM(combined.total_cogs) AS total_cogs,
      SUM(combined.total_revenue) AS total_revenue,
      SUM(combined.unpriced_units_out) AS unpriced_units_out
    FROM (
      SELECT
        mr.variant_id,
        CASE WHEN mr.is_priced THEN -mr.quantity_delta ELSE 0 END AS net_units_sold,
        CASE
          WHEN NOT mr.is_priced THEN 0
          WHEN mr.is_signed THEN -SIGN(mr.quantity_delta) * mr.cogs_total
          WHEN mr.reason IN ('online_sale', 'counter_sale') THEN mr.cogs_total
          WHEN mr.reason = 'customer_return' THEN -mr.cogs_total
          ELSE 0
        END AS total_cogs,
        CASE WHEN mr.is_priced THEN mr.revenue_amount ELSE 0 END AS total_revenue,
        CASE
          WHEN NOT mr.is_priced AND mr.reason IN ('online_sale', 'counter_sale') THEN -mr.quantity_delta
          ELSE 0
        END AS unpriced_units_out
      FROM movement_revenue mr
      UNION ALL
      SELECT
        ntl.variant_id,
        ntl.units AS net_units_sold,
        0::numeric AS total_cogs,
        ntl.revenue AS total_revenue,
        0::numeric AS unpriced_units_out
      FROM non_tracked_lines ntl
    ) combined
    GROUP BY combined.variant_id
  )
  SELECT
    pv.id, pv.sku, p.id,
    (SELECT pt.title FROM public.product_translations pt
      WHERE pt.product_id = p.id ORDER BY (pt.lang_code = 'az') DESC, pt.lang_code LIMIT 1),
    pc.category_id,
    (SELECT ct.title FROM public.category_translations ct
      WHERE ct.category_id = pc.category_id ORDER BY (ct.lang_code = 'az') DESC, ct.lang_code LIMIT 1),
    COALESCE(am.total_revenue, 0),
    COALESCE(am.total_cogs, 0),
    COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0),
    CASE WHEN COALESCE(am.total_revenue, 0) > 0
      THEN ROUND(((COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0)) / am.total_revenue) * 100, 2)
      ELSE 0 END,
    COALESCE(am.net_units_sold, 0),
    COALESCE(am.unpriced_units_out, 0)
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  -- A product can sit in several categories: report the filtered one, else the first by id.
  LEFT JOIN LATERAL (
    SELECT x.category_id FROM public.product_categories x
    WHERE x.product_id = p.id AND (p_category_id IS NULL OR x.category_id = p_category_id)
    ORDER BY x.category_id LIMIT 1
  ) pc ON true
  LEFT JOIN aggregated_metrics am ON am.variant_id = pv.id
  WHERE (p_category_id IS NULL OR pc.category_id IS NOT NULL)
    AND ((am.net_units_sold IS NOT NULL AND am.net_units_sold <> 0)
      OR (am.total_revenue IS NOT NULL AND am.total_revenue <> 0)
      OR (am.unpriced_units_out IS NOT NULL AND am.unpriced_units_out <> 0))
  ORDER BY 9 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) TO service_role;
