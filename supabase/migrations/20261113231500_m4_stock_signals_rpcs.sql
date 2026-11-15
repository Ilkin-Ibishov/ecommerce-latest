-- =============================================================================
-- Migration: M4 Stock Signals Database RPCs
-- Timestamp: 20261113231500_m4_stock_signals_rpcs.sql
-- Source: supabase/migrations/20261113220300_m4_stock_signals_rpcs.sql
-- Description:
--   Defines get_low_stock_signals, get_dead_stock_signals, and get_reorder_suggestions.
--   Revoked from public, anon, authenticated; granted exclusively to service_role.
--   Fixes audit minors:
--   - m2: has_enough_data counts transactions with net units > 0 (voided sales do not count)
--   - m3: supplier group is NULL when unassigned, not literal 'Unassigned'
--   - m4: pending_needs_owner remains out of ledger velocity, kept as-is
-- =============================================================================

-- ─── 1. Low Stock Signals RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_low_stock_signals(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  variant_id          uuid,
  product_id          uuid,
  product_title       text,
  variant_sku         text,
  barcode             text,
  unit_of_measure     text,
  on_hand             numeric,
  reserved_quantity   numeric,
  available_quantity  numeric,
  threshold           numeric,
  status              text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_global_threshold numeric;
BEGIN
  SELECT NULLIF(ss.value, '')::numeric INTO v_global_threshold
  FROM public.store_settings ss WHERE ss.key = 'low_stock_threshold';
  v_global_threshold := COALESCE(v_global_threshold, 10);

  RETURN QUERY
  WITH variant_avail AS (
    SELECT
      pv.id AS v_id,
      pv.product_id AS p_id,
      pv.sku AS v_sku,
      pv.unit_of_measure AS v_uom,
      pv.on_hand AS v_on_hand,
      COALESCE(r.reserved, 0)::numeric(12,3) AS v_reserved,
      GREATEST(0, pv.on_hand - COALESCE(r.reserved, 0))::numeric(12,3) AS v_available,
      COALESCE(pv.low_stock_threshold, v_global_threshold) AS v_thresh
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    LEFT JOIN (
      SELECT res.variant_id, SUM(res.quantity) AS reserved
      FROM public.reservations res
      WHERE res.status = 'active' AND (res.expires_at IS NULL OR res.expires_at > now())
      GROUP BY res.variant_id
    ) r ON r.variant_id = pv.id
    WHERE pv.track_stock = true
  )
  SELECT
    va.v_id,
    va.p_id,
    (SELECT pt.title FROM public.product_translations pt
     WHERE pt.product_id = va.p_id ORDER BY (pt.lang_code = 'az') DESC, pt.lang_code LIMIT 1),
    va.v_sku,
    (SELECT vb.barcode FROM public.variant_barcodes vb
     WHERE vb.variant_id = va.v_id ORDER BY vb.created_at LIMIT 1),
    va.v_uom,
    va.v_on_hand,
    va.v_reserved,
    va.v_available,
    va.v_thresh,
    CASE WHEN va.v_available <= 0 THEN 'out' ELSE 'low' END AS status
  FROM variant_avail va
  WHERE va.v_available <= va.v_thresh
    AND (p_status IS NULL
         OR (p_status = 'out' AND va.v_available <= 0)
         OR (p_status = 'low' AND va.v_available > 0))
    AND (p_search IS NULL OR char_length(trim(p_search)) = 0
         OR va.v_sku ILIKE '%' || trim(p_search) || '%'
         OR EXISTS (
              SELECT 1 FROM public.product_translations pt
              WHERE pt.product_id = va.p_id AND pt.title ILIKE '%' || trim(p_search) || '%'
            )
         OR EXISTS (
              SELECT 1 FROM public.variant_barcodes vb
              WHERE vb.variant_id = va.v_id AND vb.barcode ILIKE '%' || trim(p_search) || '%'
            ))
  ORDER BY (va.v_available <= 0) DESC, va.v_available ASC;
END;
$$;

-- ─── 2. Dead Stock Signals RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dead_stock_signals(
  p_days integer DEFAULT 90
)
RETURNS TABLE (
  variant_id                uuid,
  product_id                uuid,
  product_title             text,
  variant_sku               text,
  barcode                   text,
  unit_of_measure           text,
  on_hand                   numeric,
  days_since_last_sale      integer,
  days_since_first_receipt  integer,
  unit_cost                 numeric,
  capital_tied_up           numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH first_receipts AS (
    SELECT sm.variant_id, MIN(sm.posting_date) AS first_received
    FROM public.stock_movements sm
    GROUP BY sm.variant_id
  ),
  trailing_sales AS (
    SELECT
      sm.variant_id,
      -SUM(sm.quantity_delta) AS net_units,
      MAX(sm.posting_date) AS last_sale_date
    FROM public.stock_movements sm
    WHERE sm.reason IN ('online_sale', 'counter_sale')
      AND sm.posting_date >= now() - (p_days || ' days')::interval
    GROUP BY sm.variant_id
  ),
  lifetime_last_sale AS (
    SELECT sm.variant_id, MAX(sm.posting_date) AS last_sale_date
    FROM public.stock_movements sm
    WHERE sm.reason IN ('online_sale', 'counter_sale')
      AND sm.quantity_delta < 0
    GROUP BY sm.variant_id
  )
  SELECT
    pv.id,
    pv.product_id,
    (SELECT pt.title FROM public.product_translations pt
     WHERE pt.product_id = pv.product_id ORDER BY (pt.lang_code = 'az') DESC, pt.lang_code LIMIT 1),
    pv.sku,
    (SELECT vb.barcode FROM public.variant_barcodes vb
     WHERE vb.variant_id = pv.id ORDER BY vb.created_at LIMIT 1),
    pv.unit_of_measure,
    pv.on_hand,
    CASE
      WHEN lls.last_sale_date IS NOT NULL THEN
        GREATEST(0, EXTRACT(DAY FROM now() - lls.last_sale_date)::integer)
      ELSE
        GREATEST(0, EXTRACT(DAY FROM now() - fr.first_received)::integer)
    END AS days_since_last_sale,
    GREATEST(0, EXTRACT(DAY FROM now() - fr.first_received)::integer) AS days_since_first_receipt,
    COALESCE(vc.cost_price, vc.opening_cost, 0)::numeric(10,2) AS unit_cost,
    ROUND(pv.on_hand * COALESCE(vc.cost_price, vc.opening_cost, 0), 2)::numeric(12,2) AS capital_tied_up
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  JOIN first_receipts fr ON fr.variant_id = pv.id
  LEFT JOIN trailing_sales ts ON ts.variant_id = pv.id
  LEFT JOIN lifetime_last_sale lls ON lls.variant_id = pv.id
  LEFT JOIN public.variant_costs vc ON vc.variant_id = pv.id
  WHERE pv.track_stock = true
    AND pv.on_hand > 0
    AND fr.first_received <= now() - (p_days || ' days')::interval
    AND COALESCE(ts.net_units, 0) <= 0
  ORDER BY capital_tied_up DESC, days_since_last_sale DESC;
END;
$$;

-- ─── 3. Reorder Suggestions RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_reorder_suggestions(
  p_window_days integer DEFAULT 28,
  p_target_days integer DEFAULT 60,
  p_min_sales integer DEFAULT 3
)
RETURNS TABLE (
  variant_id          uuid,
  product_id          uuid,
  product_title       text,
  variant_sku         text,
  barcode             text,
  unit_of_measure     text,
  supplier_id         uuid,
  supplier_name       text,
  supplier_contact    text,
  on_hand             numeric,
  reserved_quantity   numeric,
  available_quantity  numeric,
  units_sold_window   numeric,
  sales_count         integer,
  velocity            numeric,
  days_of_cover       numeric,
  suggested_qty       numeric,
  has_enough_data     boolean
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH tx_net AS (
    SELECT
      sm.variant_id,
      COALESCE(sm.transaction_id::text, sm.reference_id) AS tx_id,
      -SUM(sm.quantity_delta) AS tx_units
    FROM public.stock_movements sm
    WHERE sm.reason IN ('online_sale', 'counter_sale')
      AND sm.posting_date >= now() - (p_window_days || ' days')::interval
    GROUP BY sm.variant_id, COALESCE(sm.transaction_id::text, sm.reference_id)
    HAVING -SUM(sm.quantity_delta) > 0
  ),
  sales_movements AS (
    SELECT
      tn.variant_id,
      SUM(tn.tx_units) AS net_sold,
      COUNT(DISTINCT tn.tx_id)::integer AS tx_count
    FROM tx_net tn
    GROUP BY tn.variant_id
  ),
  pending_needs_owner AS (
    SELECT
      csl.variant_id,
      SUM(csl.quantity) AS pending_sold,
      COUNT(DISTINCT cs.id)::integer AS pending_tx_count
    FROM public.counter_sale_lines csl
    JOIN public.counter_sales cs ON cs.id = csl.sale_id
    WHERE cs.status = 'needs_owner'
      AND cs.sold_at >= now() - (p_window_days || ' days')::interval
    GROUP BY csl.variant_id
  ),
  variant_sales AS (
    SELECT
      pv.id AS v_id,
      COALESCE(sm.net_sold, 0) + COALESCE(pno.pending_sold, 0) AS total_sold,
      COALESCE(sm.tx_count, 0) + COALESCE(pno.pending_tx_count, 0) AS total_tx
    FROM public.product_variants pv
    LEFT JOIN sales_movements sm ON sm.variant_id = pv.id
    LEFT JOIN pending_needs_owner pno ON pno.variant_id = pv.id
    WHERE pv.track_stock = true
  ),
  recent_suppliers AS (
    SELECT DISTINCT ON (grl.variant_id)
      grl.variant_id,
      gr.supplier_id,
      s.name AS sup_name,
      s.contact_info AS sup_contact
    FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.receipt_id
    LEFT JOIN public.suppliers s ON s.id = gr.supplier_id
    WHERE gr.status = 'posted'
    ORDER BY grl.variant_id, gr.posting_date DESC
  ),
  calculated AS (
    SELECT
      pv.id AS v_id,
      pv.product_id AS p_id,
      pv.sku AS v_sku,
      pv.unit_of_measure AS v_uom,
      pv.on_hand AS v_on_hand,
      COALESCE(r.reserved, 0)::numeric(12,3) AS v_reserved,
      (pv.on_hand - COALESCE(r.reserved, 0))::numeric(12,3) AS v_available,
      vs.total_sold AS v_sold,
      vs.total_tx AS v_sales_count,
      ROUND(vs.total_sold::numeric / p_window_days::numeric, 4) AS v_velocity,
      rs.supplier_id AS sup_id,
      rs.sup_name AS sup_name,
      rs.sup_contact AS sup_contact
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    JOIN variant_sales vs ON vs.v_id = pv.id
    LEFT JOIN recent_suppliers rs ON rs.variant_id = pv.id
    LEFT JOIN (
      SELECT res.variant_id, SUM(res.quantity) AS reserved
      FROM public.reservations res
      WHERE res.status = 'active' AND (res.expires_at IS NULL OR res.expires_at > now())
      GROUP BY res.variant_id
    ) r ON r.variant_id = pv.id
    WHERE pv.track_stock = true
      AND vs.total_sold > 0
  )
  SELECT
    c.v_id,
    c.p_id,
    (SELECT pt.title FROM public.product_translations pt
     WHERE pt.product_id = c.p_id ORDER BY (pt.lang_code = 'az') DESC, pt.lang_code LIMIT 1),
    c.v_sku,
    (SELECT vb.barcode FROM public.variant_barcodes vb
     WHERE vb.variant_id = c.v_id ORDER BY vb.created_at LIMIT 1),
    c.v_uom,
    c.sup_id,
    c.sup_name,
    c.sup_contact,
    c.v_on_hand,
    c.v_reserved,
    c.v_available,
    c.v_sold,
    c.v_sales_count,
    c.v_velocity,
    CASE WHEN c.v_velocity > 0 THEN ROUND(GREATEST(0, c.v_available) / c.v_velocity, 1) ELSE NULL END,
    CASE
      WHEN c.v_sales_count >= p_min_sales THEN
        GREATEST(0, CEIL(p_target_days * c.v_velocity - c.v_available))
      ELSE NULL
    END,
    (c.v_sales_count >= p_min_sales)
  FROM calculated c
  WHERE c.v_velocity > 0
    AND (c.v_available <= 0 OR (c.v_available / c.v_velocity) < p_target_days)
  ORDER BY c.sup_name ASC NULLS LAST, (c.v_sales_count >= p_min_sales) DESC, c.v_available ASC;
END;
$$;

-- ─── 4. Revocations and Grants (service_role only) ───────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_low_stock_signals(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_low_stock_signals(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_dead_stock_signals(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dead_stock_signals(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_reorder_suggestions(integer, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions(integer, integer, integer) TO service_role;
