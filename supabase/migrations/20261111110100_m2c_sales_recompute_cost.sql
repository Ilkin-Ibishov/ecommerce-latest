-- Migration: refresh the cost projection when an online order or a deposit pick-up
-- takes stock out.
--
-- decrement_order_stock (20261104181000) and fulfil_reservation (20261104182000) insert
-- sale movements but never call recompute_variant_cost, so the margin report did not
-- see those sales until the next receipt or stocktake replayed the variant.
-- Both bodies are unchanged apart from the recompute call added at the end.
-- Grants restate 20261111100000 (service_role only).

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
  v_rec record;
BEGIN
  -- Verify all requested variants exist before locking
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) elem
    WHERE COALESCE(
      (SELECT pv.id FROM public.product_variants pv WHERE pv.id = (elem->>'variant_id')::uuid),
      (SELECT pv.id FROM public.product_variants pv WHERE pv.product_id = (elem->>'variant_id')::uuid AND pv.is_default = true LIMIT 1)
    ) IS NULL
  ) THEN
    RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'ST002';
  END IF;

  -- Check tenant setting for negative stock
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

  -- Lock variants in deterministic ASCENDING order to prevent deadlocks
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
    SELECT
      agg.variant_id,
      agg.req_qty,
      pv.on_hand
    FROM aggregated agg
    JOIN public.product_variants pv ON pv.id = agg.variant_id
    ORDER BY pv.id ASC
    FOR UPDATE OF pv
  LOOP
    -- Calculate active reservations for this variant
    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM public.reservations
    WHERE variant_id = v_rec.variant_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    v_available := v_rec.on_hand - v_reserved;

    -- Check availability unless allow_negative_stock is enabled
    IF NOT v_allow_negative AND v_available < v_rec.req_qty THEN
      RAISE EXCEPTION 'Insufficient available stock for variant % (available: %, requested: %)',
        v_rec.variant_id, GREATEST(0, v_available), v_rec.req_qty USING ERRCODE = 'ST014';
    END IF;
  END LOOP;

  -- All checks passed — insert movements for all lines in the order
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant_id := COALESCE(
      (SELECT pv.id FROM public.product_variants pv WHERE pv.id = (v_line->>'variant_id')::uuid),
      (SELECT pv.id FROM public.product_variants pv WHERE pv.product_id = (v_line->>'variant_id')::uuid AND pv.is_default = true LIMIT 1)
    );
    v_qty := (v_line->>'quantity')::numeric;

    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, actor_id
    ) VALUES (
      v_variant_id, -v_qty, 'online_sale', 'order', p_order_id::text, p_actor_id
    );
  END LOOP;

  -- Keep the cost projection current: replay once per distinct variant from this
  -- transaction's posting_date (the movements' default), as post_goods_receipt does.
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
BEGIN
  -- 1. Lock reservation row FOR UPDATE
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

  -- 2. Apply final payment and verify full payment
  v_new_paid := v_res.paid_amount + COALESCE(p_final_payment, 0);

  IF v_new_paid <> v_res.agreed_price THEN
    v_shortfall := v_res.agreed_price - v_new_paid;
    RAISE EXCEPTION 'ST015: Shortfall of % AZN: total paid % does not equal agreed price %',
      v_shortfall, v_new_paid, v_res.agreed_price USING ERRCODE = 'ST015';
  END IF;

  -- 3. Set reservation to fulfilled BEFORE inserting movement (C6 invariant)
  UPDATE public.reservations
  SET status = 'fulfilled',
      paid_amount = v_new_paid,
      fulfilled_by = p_actor_id,
      fulfilled_at = now(),
      updated_at = now()
  WHERE id = p_reservation_id
  RETURNING * INTO v_res;

  -- 4. Insert physical inventory exit (counter_sale)
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id
  ) VALUES (
    v_res.variant_id,
    -v_res.quantity,
    'counter_sale',
    'reservation',
    p_reservation_id::text,
    p_actor_id
  );

  -- Keep the cost projection current, as post_goods_receipt does.
  PERFORM public.recompute_variant_cost(v_res.variant_id, now());

  RETURN to_jsonb(v_res);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) TO service_role;
