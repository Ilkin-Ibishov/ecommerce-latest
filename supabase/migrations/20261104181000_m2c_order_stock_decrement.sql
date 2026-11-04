-- ─── M2c C1: Atomic Order Stock Decrement ─────────────────────────────
-- Locks variants in ascending variant_id order to prevent deadlocks.
-- Checks availability for all lines against active reservations.
-- Fails atomically with ST014 if any line has insufficient available stock.

CREATE OR REPLACE FUNCTION decrement_order_stock(
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
END;
$$;

REVOKE EXECUTE ON FUNCTION decrement_order_stock(uuid, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION decrement_order_stock(uuid, jsonb, uuid) TO service_role;
