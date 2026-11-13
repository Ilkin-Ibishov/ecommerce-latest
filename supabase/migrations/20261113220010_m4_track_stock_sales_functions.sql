-- =============================================================================
-- Migration: M4 Sales & Fulfillment Functions Skip Non-Tracked Variants
-- Timestamp: 20261113220010_m4_track_stock_sales_functions.sql
-- Description:
--   Updates post_counter_sale, post_pending_counter_sale, decrement_order_stock,
--   and fulfil_reservation to filter out non-tracked variants (track_stock = false),
--   preventing ST030 exceptions and ensuring non-tracked items sell without movements.
-- =============================================================================

-- ─── 1. post_counter_sale ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_counter_sale(
  p_sale jsonb,
  p_payload_hash text,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid := (p_sale->>'id')::uuid;
  v_existing_hash text;
  v_posting timestamptz := now();
  v_total numeric(12,2) := (p_sale->>'total_amount')::numeric;
  v_inserted integer;
  v_wanted integer;
  v_locked integer;
  v_var record;
BEGIN
  -- 1. Idempotency check
  SELECT payload_hash INTO v_existing_hash FROM public.counter_sales WHERE id = v_id;
  IF FOUND THEN
    IF v_existing_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'Counter sale % already exists with a different payload', v_id USING ERRCODE = 'ST020';
    END IF;
    RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', true);
  END IF;

  IF jsonb_array_length(COALESCE(p_sale->'lines', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A counter sale needs at least one line' USING ERRCODE = 'ST024';
  END IF;

  -- 2. Lock every variant once, ascending id
  SELECT count(DISTINCT (l->>'variant_id')::uuid) INTO v_wanted
  FROM jsonb_array_elements(p_sale->'lines') l;

  WITH locked AS (
    SELECT pv.id FROM public.product_variants pv
    WHERE pv.id IN (SELECT (l->>'variant_id')::uuid FROM jsonb_array_elements(p_sale->'lines') l)
    ORDER BY pv.id
    FOR UPDATE
  )
  SELECT count(*) INTO v_locked FROM locked;

  IF v_locked <> v_wanted THEN
    RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'ST002';
  END IF;

  -- 3. Check line totals sum to sale total
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale->'lines') l WHERE (l->>'net_line_total')::numeric < 0)
     OR (SELECT sum((l->>'net_line_total')::numeric) FROM jsonb_array_elements(p_sale->'lines') l) <> v_total THEN
    RAISE EXCEPTION 'Line totals do not sum to the sale total %', v_total USING ERRCODE = 'ST023';
  END IF;

  -- 4. Insert header
  INSERT INTO public.counter_sales (
    id, payload_hash, sold_at, posting_date, payment_method, bundle_discount, owner_discount,
    total_amount, displayed_total, total_mismatch, note, cashier_id, posted_by, status
  ) VALUES (
    v_id, p_payload_hash, (p_sale->>'sold_at')::timestamptz, v_posting, p_sale->>'payment_method',
    COALESCE((p_sale->>'bundle_discount')::numeric, 0), COALESCE((p_sale->>'owner_discount')::numeric, 0),
    v_total, (p_sale->>'displayed_total')::numeric, (p_sale->>'displayed_total')::numeric <> v_total,
    NULLIF(trim(p_sale->>'note'), ''), p_session_user, p_session_user, 'posted'
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT payload_hash INTO v_existing_hash FROM public.counter_sales WHERE id = v_id;
    IF v_existing_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'Counter sale % already exists with a different payload', v_id USING ERRCODE = 'ST020';
    END IF;
    RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', true);
  END IF;

  -- 5. Insert lines with computed flags
  INSERT INTO public.counter_sale_lines (
    sale_id, line_no, variant_id, quantity, list_unit_price, charged_unit_price, bundle_id,
    net_line_total, price_mismatch, reservation_override
  )
  SELECT
    v_id, l.line_no, l.variant_id, l.quantity, pv.price, l.charged_unit_price, l.bundle_id,
    l.net_line_total,
    l.charged_unit_price <> pv.price,
    pv.track_stock AND COALESCE(r.reserved, 0) > 0 AND pv.on_hand - COALESCE(r.reserved, 0) - s.sale_qty < 0
  FROM jsonb_to_recordset(p_sale->'lines') AS l(
    line_no integer, variant_id uuid, quantity integer, charged_unit_price numeric,
    bundle_id uuid, net_line_total numeric)
  JOIN public.product_variants pv ON pv.id = l.variant_id
  JOIN (
    SELECT (x->>'variant_id')::uuid AS variant_id, sum((x->>'quantity')::integer) AS sale_qty
    FROM jsonb_array_elements(p_sale->'lines') x GROUP BY 1
  ) s ON s.variant_id = l.variant_id
  LEFT JOIN (
    SELECT variant_id, sum(quantity) AS reserved FROM public.reservations
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
    GROUP BY variant_id
  ) r ON r.variant_id = l.variant_id;

  -- 6. Insert movements and cost replay ONLY for tracked variants
  BEGIN
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id, posting_date, actor_id
    )
    SELECT csl.variant_id, -csl.quantity, 'counter_sale', 'counter_sale', v_id::text, v_id, v_posting, p_session_user
    FROM public.counter_sale_lines csl
    JOIN public.product_variants pv ON pv.id = csl.variant_id
    WHERE csl.sale_id = v_id AND pv.track_stock = true
    ORDER BY csl.line_no;

    FOR v_var IN
      SELECT DISTINCT csl.variant_id
      FROM public.counter_sale_lines csl
      JOIN public.product_variants pv ON pv.id = csl.variant_id
      WHERE csl.sale_id = v_id AND pv.track_stock = true
      ORDER BY 1
    LOOP
      PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'ST001' THEN
    UPDATE public.counter_sales SET status = 'needs_owner', needs_owner_reason = 'on_hand' WHERE id = v_id;
  END;

  RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) TO service_role;

-- ─── 2. post_pending_counter_sale ────────────────────────────────────────────
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

  -- Only insert movements for tracked variants
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

-- ─── 3. decrement_order_stock ────────────────────────────────────────────────
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
  -- Verify all requested variants exist
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

  -- Insert movements only for tracked variants
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

-- ─── 4. fulfil_reservation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fulfil_reservation(
  p_reservation_id uuid,
  p_actor_id uuid,
  p_final_payment numeric DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_new_paid numeric(10,2);
  v_shortfall numeric(10,2);
  v_track_stock boolean;
BEGIN
  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found: %', p_reservation_id USING ERRCODE = 'ST016';
  END IF;

  IF v_res.status <> 'active' THEN
    RAISE EXCEPTION 'Reservation % is already %; only active reservations can be fulfilled',
      p_reservation_id, v_res.status USING ERRCODE = 'ST017';
  END IF;

  v_new_paid := v_res.paid_amount + COALESCE(p_final_payment, 0);

  IF v_new_paid <> v_res.agreed_price THEN
    v_shortfall := v_res.agreed_price - v_new_paid;
    RAISE EXCEPTION 'ST015: Shortfall of % AZN: total paid % does not equal agreed price %',
      v_shortfall, v_new_paid, v_res.agreed_price USING ERRCODE = 'ST015';
  END IF;

  UPDATE public.reservations
  SET status = 'fulfilled',
      paid_amount = v_new_paid,
      fulfilled_by = p_actor_id,
      fulfilled_at = now(),
      updated_at = now()
  WHERE id = p_reservation_id
  RETURNING * INTO v_res;

  SELECT track_stock INTO v_track_stock FROM public.product_variants WHERE id = v_res.variant_id;
  IF v_track_stock THEN
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, actor_id
    ) VALUES (
      v_res.variant_id, -v_res.quantity, 'counter_sale', 'reservation', p_reservation_id::text, p_actor_id
    );

    PERFORM public.recompute_variant_cost(v_res.variant_id, now());
  END IF;

  RETURN to_jsonb(v_res);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) TO service_role;
