-- =============================================================================
-- Migration: M4 track_stock filters in sales and fulfillment functions
-- Timestamp: 20261113231100_m4_track_stock_sales_functions.sql
-- Sources:
--   - post_pending_counter_sale: supabase/migrations/20261111120500_m3_post_pending_counter_sale.sql
--   - decrement_order_stock:     supabase/migrations/20261111110100_m2c_sales_recompute_cost.sql
--   - void_counter_sale:         supabase/migrations/20261111120600_m3_void_counter_sale.sql
-- Description:
--   post_pending_counter_sale, decrement_order_stock, and void_counter_sale
--   write movements only for track_stock = true lines.
--   Not fulfil_reservation (review D3). Not post_counter_sale (unified in 231200).
-- =============================================================================

-- ─── 1. post_pending_counter_sale ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_pending_counter_sale(
  p_id uuid,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
  v_posting timestamptz;
  v_var record;
BEGIN
  SELECT status, posting_date INTO v_status, v_posting
  FROM public.counter_sales WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Counter sale not found: %', p_id USING ERRCODE = 'ST016';
  END IF;
  IF v_status <> 'needs_owner' THEN
    RAISE EXCEPTION 'Counter sale % is %; only needs_owner sales can be posted', p_id, v_status
      USING ERRCODE = 'ST025';
  END IF;

  PERFORM 1 FROM public.product_variants pv
  WHERE pv.id IN (SELECT variant_id FROM public.counter_sale_lines WHERE sale_id = p_id)
  ORDER BY pv.id
  FOR UPDATE;

  INSERT INTO public.stock_movements (
    variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id, posting_date, actor_id
  )
  SELECT csl.variant_id, -csl.quantity, 'counter_sale', 'counter_sale', p_id::text, p_id, v_posting, p_session_user
  FROM public.counter_sale_lines csl
  JOIN public.product_variants pv ON pv.id = csl.variant_id
  WHERE csl.sale_id = p_id AND pv.track_stock = true
  ORDER BY csl.line_no;

  FOR v_var IN
    SELECT DISTINCT csl.variant_id
    FROM public.counter_sale_lines csl
    JOIN public.product_variants pv ON pv.id = csl.variant_id
    WHERE csl.sale_id = p_id AND pv.track_stock = true
    ORDER BY 1
  LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
  END LOOP;

  UPDATE public.counter_sale_lines l
  SET posted_after_count = EXISTS (
    SELECT 1 FROM public.stocktake_line_snapshots s
    JOIN public.stocktake_lines sl ON sl.id = s.line_id
    JOIN public.stocktakes st ON st.id = sl.stocktake_id AND st.status <> 'cancelled'
    WHERE sl.variant_id = l.variant_id AND s.captured_at > v_posting)
  WHERE l.sale_id = p_id;

  UPDATE public.counter_sales
  SET status = 'posted', resolved_by = p_session_user, resolved_at = now()
  WHERE id = p_id;

  RETURN public.counter_sale_json(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_pending_counter_sale(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_pending_counter_sale(uuid, uuid) TO service_role;

-- ─── 2. decrement_order_stock ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_order_stock(
  p_order_id uuid,
  p_lines jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line jsonb;
  v_variant_id uuid;
  v_qty numeric;
  v_reserved numeric;
  v_available numeric;
  v_allow_negative boolean := false;
  v_track_stock boolean;
  v_rec record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) elem
    WHERE COALESCE(
      (SELECT pv.id FROM public.product_variants pv WHERE pv.id = (elem->>'variant_id')::uuid),
      (SELECT pv.id FROM public.product_variants pv WHERE pv.product_id = (elem->>'variant_id')::uuid AND pv.is_default = true LIMIT 1)
    ) IS NULL
  ) THEN
    RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'ST002';
  END IF;

  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

  FOR v_rec IN
    WITH aggregated AS (
      SELECT
        COALESCE(
          (SELECT pv.id FROM public.product_variants pv WHERE pv.id = (elem->>'variant_id')::uuid),
          (SELECT pv.id FROM public.product_variants pv WHERE pv.product_id = (elem->>'variant_id')::uuid AND pv.is_default = true LIMIT 1)
        ) AS variant_id,
        SUM((elem->>'quantity')::numeric) AS req_qty
      FROM jsonb_array_elements(p_lines) elem
      GROUP BY 1
    )
    SELECT agg.variant_id, agg.req_qty, pv.on_hand, pv.track_stock
    FROM aggregated agg
    JOIN public.product_variants pv ON pv.id = agg.variant_id
    ORDER BY pv.id ASC
    FOR UPDATE OF pv
  LOOP
    IF v_rec.track_stock THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
      FROM public.reservations
      WHERE variant_id = v_rec.variant_id
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now());

      v_available := v_rec.on_hand - v_reserved;

      IF NOT v_allow_negative AND v_available < v_rec.req_qty THEN
        RAISE EXCEPTION 'Insufficient available stock for variant % (available: %, requested: %)',
          v_rec.variant_id, GREATEST(0, v_available), v_rec.req_qty USING ERRCODE = 'ST014';
      END IF;
    END IF;
  END LOOP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := COALESCE(
      (SELECT pv.id FROM public.product_variants pv WHERE pv.id = (v_line->>'variant_id')::uuid),
      (SELECT pv.id FROM public.product_variants pv WHERE pv.product_id = (v_line->>'variant_id')::uuid AND pv.is_default = true LIMIT 1)
    );
    v_qty := (v_line->>'quantity')::numeric;

    SELECT track_stock INTO v_track_stock FROM public.product_variants WHERE id = v_variant_id;
    IF v_track_stock THEN
      INSERT INTO public.stock_movements (
        variant_id, quantity_delta, reason, reference_type, reference_id, actor_id
      ) VALUES (
        v_variant_id, -v_qty, 'online_sale', 'order', p_order_id::text, p_actor_id
      );
    END IF;
  END LOOP;

  FOR v_variant_id IN
    SELECT DISTINCT sm.variant_id FROM public.stock_movements sm
    WHERE sm.reference_type = 'order' AND sm.reference_id = p_order_id::text AND sm.posting_date = now()
  LOOP
    PERFORM public.recompute_variant_cost(v_variant_id, now());
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrement_order_stock(uuid, jsonb, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_order_stock(uuid, jsonb, uuid) TO service_role;

-- ─── 3. void_counter_sale ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_counter_sale(
  p_id uuid,
  p_reason text,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
  v_posting timestamptz;
  v_var record;
BEGIN
  IF p_reason IS NULL OR char_length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A void needs a reason' USING ERRCODE = 'ST026';
  END IF;

  SELECT status, posting_date INTO v_status, v_posting
  FROM public.counter_sales WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Counter sale not found: %', p_id USING ERRCODE = 'ST016';
  END IF;
  IF v_status = 'voided' THEN
    RAISE EXCEPTION 'Counter sale % is already voided', p_id USING ERRCODE = 'ST022';
  END IF;

  IF v_status = 'posted' THEN
    PERFORM 1 FROM public.product_variants pv
    WHERE pv.id IN (SELECT variant_id FROM public.counter_sale_lines WHERE sale_id = p_id)
    ORDER BY pv.id
    FOR UPDATE;

    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id,
      correlation_id, posting_date, actor_id, note
    )
    SELECT sm.variant_id, -sm.quantity_delta, 'counter_sale', 'counter_sale', sm.reference_id,
           sm.transaction_id, sm.id, sm.posting_date, p_session_user, 'void'
    FROM public.stock_movements sm
    JOIN public.product_variants pv ON pv.id = sm.variant_id
    WHERE sm.transaction_id = p_id AND sm.reference_type = 'counter_sale' AND sm.quantity_delta < 0
      AND pv.track_stock = true
    ORDER BY sm.created_at, sm.id;

    FOR v_var IN
      SELECT DISTINCT csl.variant_id
      FROM public.counter_sale_lines csl
      JOIN public.product_variants pv ON pv.id = csl.variant_id
      WHERE csl.sale_id = p_id AND pv.track_stock = true
      ORDER BY 1
    LOOP
      PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
    END LOOP;

    UPDATE public.counter_sale_lines l
    SET posted_after_count = EXISTS (
      SELECT 1 FROM public.stocktake_line_snapshots s
      JOIN public.stocktake_lines sl ON sl.id = s.line_id
      JOIN public.stocktakes st ON st.id = sl.stocktake_id AND st.status <> 'cancelled'
      WHERE sl.variant_id = l.variant_id AND s.captured_at > v_posting)
    WHERE l.sale_id = p_id;
  END IF;

  UPDATE public.counter_sales
  SET status = 'voided', voided_by = p_session_user, voided_at = now(), void_reason = trim(p_reason)
  WHERE id = p_id;

  RETURN public.counter_sale_json(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_counter_sale(uuid, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_counter_sale(uuid, text, uuid) TO service_role;
