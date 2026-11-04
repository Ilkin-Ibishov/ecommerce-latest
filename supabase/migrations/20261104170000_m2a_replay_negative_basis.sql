-- =============================================================================
-- Migration: M2a Recompute Variant Cost Negative Basis Clamp & Zero Division Guard
-- Timestamp: 20261104170000_m2a_replay_negative_basis.sql
-- Description:
--   Redefines recompute_variant_cost:
--   1. Clamps basis_qty on opening_balance: GREATEST(0, v_basis_qty + v_m.quantity_delta)
--   2. Guards denominator on goods_receipt: when v_basis_qty + v_m.quantity_delta <= 0,
--      treat receipt as fresh basis instead of dividing by zero.
-- Note: Redefines recompute_variant_cost in full (~210 lines) to maintain PL/pgSQL function atomicity.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recompute_variant_cost(
  p_variant_id uuid,
  p_from_date timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_m record;
  v_qty numeric(12,3) := 0;
  v_basis_qty numeric(12,3) := 0;
  v_avg_cost numeric(10,4) := 0;
  v_has_unknown boolean := false;
  v_unit_cost numeric(10,2);
  v_total_cost numeric(12,2);
  v_opening_cost numeric(10,2);
  v_anchor_found boolean := false;
  v_lock_k1 integer;
  v_lock_k2 integer;
BEGIN
  -- 1. Collision-free advisory transaction lock: derive two 32-bit integers from UUID (64 bits)
  v_lock_k1 := ('x' || substr(replace(p_variant_id::text, '-', ''), 1, 8))::bit(32)::integer;
  v_lock_k2 := ('x' || substr(replace(p_variant_id::text, '-', ''), 9, 8))::bit(32)::integer;
  PERFORM pg_advisory_xact_lock(v_lock_k1, v_lock_k2);

  -- 2. Extract opening cost carrier for opening balances
  SELECT opening_cost INTO v_opening_cost
  FROM public.variant_costs
  WHERE variant_id = p_variant_id;

  -- 3. Determine Recompute Horizon & Anchor Boundary (R1 Three Disjoint Sets)
  IF p_from_date IS NOT NULL THEN
    SELECT 
      running_quantity, 
      running_cost_basis_qty, 
      running_avg_cost, 
      has_unknown_cost_basis
    INTO 
      v_qty, 
      v_basis_qty, 
      v_avg_cost, 
      v_has_unknown
    FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date < p_from_date
    ORDER BY posting_date DESC, created_at DESC, movement_id DESC
    LIMIT 1;

    IF FOUND THEN
      v_anchor_found := true;
    END IF;
  END IF;

  -- Delete strictly from p_from_date forward (or all rows if full replay)
  IF p_from_date IS NOT NULL THEN
    DELETE FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date >= p_from_date;

    IF NOT v_anchor_found THEN
      v_qty := 0;
      v_basis_qty := 0;
      v_avg_cost := 0;
      v_has_unknown := false;
    END IF;
  ELSE
    DELETE FROM public.stock_movement_costs WHERE variant_id = p_variant_id;
    v_qty := 0;
    v_basis_qty := 0;
    v_avg_cost := 0;
    v_has_unknown := false;
  END IF;

  -- 4. Stream movements from p_from_date forward in strict deterministic order
  FOR v_m IN (
    SELECT
      sm.id AS movement_id,
      sm.posting_date,
      sm.created_at,
      sm.quantity_delta,
      sm.reason,
      sm.reference_type,
      sm.reference_id,
      grlc.unit_cost AS receipt_cost
    FROM public.stock_movements sm
    LEFT JOIN public.goods_receipt_lines grl 
      ON sm.reason = 'goods_receipt' 
     AND sm.reference_type = 'goods_receipt_line' 
     AND grl.id::text = sm.reference_id
    LEFT JOIN public.goods_receipt_line_costs grlc 
      ON grlc.line_id = grl.id
    WHERE sm.variant_id = p_variant_id
      AND (p_from_date IS NULL OR sm.posting_date >= p_from_date)
    ORDER BY sm.posting_date ASC, sm.created_at ASC, sm.id ASC
  ) LOOP

    -- CASE A: Inbound goods receipt
    IF v_m.reason = 'goods_receipt' THEN
      v_unit_cost := COALESCE(v_m.receipt_cost, 0);
      v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);

      -- F6 Guard: avoid division by zero when basis + incoming delta <= 0
      IF v_basis_qty + v_m.quantity_delta <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := GREATEST(0, v_m.quantity_delta);
      ELSIF v_basis_qty <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := GREATEST(0, v_m.quantity_delta);
      ELSE
        v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
        v_basis_qty := v_basis_qty + v_m.quantity_delta;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE B: Opening balance with carrier lookup
    ELSIF v_m.reason = 'opening_balance' THEN
      IF v_opening_cost IS NOT NULL AND v_opening_cost > 0 THEN
        v_unit_cost := v_opening_cost;
        v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);
        IF v_basis_qty <= 0 THEN
          v_avg_cost := v_unit_cost;
        ELSE
          IF v_basis_qty + v_m.quantity_delta > 0 THEN
            v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
          ELSE
            v_avg_cost := v_unit_cost;
          END IF;
        END IF;
        -- F6 Clamp: Basis cannot become negative from negative opening balance
        v_basis_qty := GREATEST(0, v_basis_qty + v_m.quantity_delta);
        v_has_unknown := false;
      ELSE
        -- Unvalued opening balance: excluded from average, not averaged as 0
        v_unit_cost := 0;
        v_total_cost := 0;
        v_has_unknown := true;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE C: Customer return with explicit order resolution
    ELSIF v_m.reason = 'customer_return' THEN
      v_unit_cost := NULL;

      IF v_m.reference_type = 'order' AND v_m.reference_id IS NOT NULL THEN
        SELECT smc.unit_cost INTO v_unit_cost
        FROM public.stock_movements sm_orig
        JOIN public.stock_movement_costs smc ON smc.movement_id = sm_orig.id
        WHERE sm_orig.variant_id = p_variant_id
          AND sm_orig.reference_type = 'order'
          AND sm_orig.reference_id = v_m.reference_id
          AND sm_orig.reason IN ('online_sale', 'counter_sale')
          AND (sm_orig.posting_date, sm_orig.created_at, sm_orig.id) < (v_m.posting_date, v_m.created_at, v_m.movement_id)
        ORDER BY sm_orig.posting_date DESC, sm_orig.created_at DESC, sm_orig.id DESC
        LIMIT 1;
      END IF;

      -- If unreferenced return or not found, explicitly fall back to current average
      v_unit_cost := COALESCE(v_unit_cost, v_avg_cost);
      v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);

      IF v_basis_qty <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := v_m.quantity_delta;
      ELSE
        v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
        v_basis_qty := v_basis_qty + v_m.quantity_delta;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE D: Outbound consumption (online_sale, counter_sale, write-off, return_to_supplier, etc.)
    ELSE
      v_unit_cost := v_avg_cost;
      v_total_cost := ROUND(ABS(v_m.quantity_delta) * v_unit_cost, 2);
      v_qty := v_qty + v_m.quantity_delta;
      v_basis_qty := GREATEST(0, v_basis_qty + v_m.quantity_delta);
      IF v_basis_qty = 0 AND v_qty > 0 THEN
        v_has_unknown := true;
      END IF;
    END IF;

    -- Insert valuation projection row
    INSERT INTO public.stock_movement_costs (
      movement_id,
      variant_id,
      posting_date,
      created_at,
      quantity_delta,
      unit_cost,
      total_cost,
      running_quantity,
      running_cost_basis_qty,
      running_avg_cost,
      has_unknown_cost_basis,
      computed_at
    ) VALUES (
      v_m.movement_id,
      p_variant_id,
      v_m.posting_date,
      v_m.created_at,
      v_m.quantity_delta,
      v_unit_cost,
      v_total_cost,
      v_qty,
      v_basis_qty,
      v_avg_cost,
      v_has_unknown,
      now()
    );
  END LOOP;

  -- 5. Refresh fast lookup cache via atomic UPSERT
  INSERT INTO public.variant_costs (variant_id, cost_price, updated_at)
  VALUES (p_variant_id, ROUND(v_avg_cost, 2), now())
  ON CONFLICT (variant_id)
  DO UPDATE SET
    cost_price = EXCLUDED.cost_price,
    updated_at = EXCLUDED.updated_at;
END;
$$;

-- ─── Privileges Configuration ────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.recompute_variant_cost(uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_variant_cost(uuid, timestamptz) TO service_role;
