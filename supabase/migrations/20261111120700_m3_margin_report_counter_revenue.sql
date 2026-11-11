-- Migration: margin report counts counter-sale and deposit pick-up revenue (design note Q4).
-- Same signature and grants as 20261104110000. Changes:
--   * counter_sale movements with reference_type 'counter_sale' are priced from their sale's
--     lines (joined uuid to uuid on transaction_id), rounded per movement;
--   * reservation pick-ups are priced at the reservation's agreed_price;
--   * counter and pick-up terms are signed by quantity_delta, so a sale and its void net to
--     zero on units, revenue and cost;
--   * every reference_id::uuid cast is guarded by its reference_type (spec audit F13).
-- Online order and customer-return terms are computed exactly as before.

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
  aggregated_metrics AS (
    SELECT
      mr.variant_id,
      SUM(CASE WHEN mr.is_priced THEN -mr.quantity_delta ELSE 0 END) AS net_units_sold,
      SUM(CASE
        WHEN NOT mr.is_priced THEN 0
        WHEN mr.is_signed THEN -SIGN(mr.quantity_delta) * mr.cogs_total
        WHEN mr.reason IN ('online_sale', 'counter_sale') THEN mr.cogs_total
        WHEN mr.reason = 'customer_return' THEN -mr.cogs_total
        ELSE 0
      END) AS total_cogs,
      SUM(CASE WHEN mr.is_priced THEN mr.revenue_amount ELSE 0 END) AS total_revenue,
      SUM(CASE
        WHEN NOT mr.is_priced AND mr.reason IN ('online_sale', 'counter_sale') THEN -mr.quantity_delta
        ELSE 0
      END) AS unpriced_units_out
    FROM movement_revenue mr
    GROUP BY mr.variant_id
  )
  SELECT
    pv.id, pv.sku, p.id, p.title, c.id, c.name,
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
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN aggregated_metrics am ON am.variant_id = pv.id
  WHERE (p_category_id IS NULL OR p.category_id = p_category_id)
    AND ((am.net_units_sold IS NOT NULL AND am.net_units_sold <> 0)
      OR (am.total_revenue IS NOT NULL AND am.total_revenue <> 0)
      OR (am.unpriced_units_out IS NOT NULL AND am.unpriced_units_out <> 0))
  ORDER BY 9 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) TO service_role;
