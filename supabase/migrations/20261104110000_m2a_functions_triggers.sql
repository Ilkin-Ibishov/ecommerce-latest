-- =============================================================================
-- Migration: M2a Functions, Triggers, Cost Engine & Integrity RPCs
-- Timestamp: 20261104110000_m2a_functions_triggers.sql
-- Description:
--   1. Immutability guard for product_variants.unit_of_measure once movements exist
--   2. Operational repair function rebuild_on_hand and trigger bypass
--   3. Diagnostic audit function verify_stock_integrity
--   4. set_variant_stock_safe RPC (with set_product_stock_safe alias)
--   5. Deterministic replay engine recompute_variant_cost
--   6. Atomic document posting RPC post_goods_receipt
--   7. Atomic reversing document RPC reverse_goods_receipt
--   8. Granularity-corrected margin report RPC get_margin_report
-- =============================================================================

-- ─── 1. Unit of Measure Immutability Guard ───────────────────────────────────
CREATE OR REPLACE FUNCTION trg_guard_variant_uom_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure THEN
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE variant_id = OLD.id) THEN
      RAISE EXCEPTION 'unit_of_measure cannot be changed once stock movements exist for variant %', OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_guard_uom ON public.product_variants;
CREATE TRIGGER product_variants_guard_uom
BEFORE UPDATE OF unit_of_measure ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_variant_uom_immutable();


-- ─── 2. On-Hand Repair Support in Variant Guard Trigger ───────────────────────
CREATE OR REPLACE FUNCTION trg_guard_variant_on_hand_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand 
     AND pg_trigger_depth() <= 1 
     AND COALESCE(current_setting('inventory.allow_on_hand_repair', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Direct update of product_variants.on_hand is forbidden. Changes must be recorded via stock_movements.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;


-- ─── 2b. Stock Movement Apply Trigger (allow_negative_stock support) ───────────
CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric(12,3);
  v_allow_negative boolean := false;
BEGIN
  -- Check tenant setting for negative stock
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

  IF v_allow_negative THEN
    UPDATE public.product_variants
    SET on_hand = on_hand + NEW.quantity_delta,
        updated_at = now()
    WHERE id = NEW.variant_id
    RETURNING on_hand INTO v_new_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
    END IF;

    IF v_new_stock < 0 THEN
      NEW.negative_stock_override := true;
    END IF;
  ELSE
    UPDATE public.product_variants
    SET on_hand = on_hand + NEW.quantity_delta,
        updated_at = now()
    WHERE id = NEW.variant_id AND (on_hand + NEW.quantity_delta) >= 0
    RETURNING on_hand INTO v_new_stock;

    IF NOT FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = NEW.variant_id) THEN
        RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
      ELSE
        RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id USING ERRCODE = 'ST001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_after_insert ON public.stock_movements;
DROP TRIGGER IF EXISTS stock_movements_before_insert ON public.stock_movements;
CREATE TRIGGER stock_movements_before_insert
BEFORE INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_movement();


-- ─── 3. Operational Repair: rebuild_on_hand ──────────────────────────────────
CREATE OR REPLACE FUNCTION rebuild_on_hand(p_variant_id uuid)
RETURNS TABLE (
  variant_id         uuid,
  previous_on_hand   numeric(12,3),
  repaired_on_hand   numeric(12,3),
  delta              numeric(12,3)
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cached_on_hand numeric(12,3);
  v_true_on_hand   numeric(12,3);
BEGIN
  -- 1. Exclusively lock the variant row to serialize against concurrent sales/receipts
  SELECT pv.on_hand INTO v_cached_on_hand
  FROM public.product_variants pv
  WHERE pv.id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', p_variant_id USING ERRCODE = 'ST002';
  END IF;

  -- 2. Compute canonical truth from immutable ledger
  SELECT COALESCE(SUM(sm.quantity_delta), 0) INTO v_true_on_hand
  FROM public.stock_movements sm
  WHERE sm.variant_id = p_variant_id;

  -- 3. If divergent, authorize repair for this transaction and update
  IF v_cached_on_hand IS DISTINCT FROM v_true_on_hand THEN
    PERFORM set_config('inventory.allow_on_hand_repair', 'true', true);

    UPDATE public.product_variants
    SET on_hand = v_true_on_hand,
        updated_at = now()
    WHERE id = p_variant_id;
  END IF;

  RETURN QUERY SELECT p_variant_id, v_cached_on_hand, v_true_on_hand, (v_true_on_hand - v_cached_on_hand);
END;
$$;


-- ─── 4. Stock Integrity Verification ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_stock_integrity()
RETURNS TABLE (
  variant_id      uuid,
  sku             text,
  check_name      text,
  expected_value  numeric,
  actual_value    numeric,
  diff            numeric,
  details         text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  -- Check 1: Ledger sum vs Cached on_hand
  WITH ledger_totals AS (
    SELECT sm.variant_id, COALESCE(SUM(sm.quantity_delta), 0) AS true_qty
    FROM public.stock_movements sm
    GROUP BY sm.variant_id
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'ledger_vs_on_hand'::text AS check_name,
    COALESCE(lt.true_qty, 0) AS expected_value,
    pv.on_hand AS actual_value,
    (pv.on_hand - COALESCE(lt.true_qty, 0)) AS diff,
    'Cached on_hand does not match sum of stock_movements'::text AS details
  FROM public.product_variants pv
  LEFT JOIN ledger_totals lt ON lt.variant_id = pv.id
  WHERE pv.on_hand IS DISTINCT FROM COALESCE(lt.true_qty, 0)

  UNION ALL

  -- Check 2: Latest projection running_quantity vs Ledger sum (R1 replay integrity)
  WITH latest_projection AS (
    SELECT DISTINCT ON (smc.variant_id)
      smc.variant_id,
      smc.running_quantity,
      smc.running_avg_cost
    FROM public.stock_movement_costs smc
    ORDER BY smc.variant_id, smc.posting_date DESC, smc.created_at DESC, smc.movement_id DESC
  ),
  ledger_totals AS (
    SELECT sm.variant_id, COALESCE(SUM(sm.quantity_delta), 0) AS true_qty
    FROM public.stock_movements sm
    GROUP BY sm.variant_id
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'projection_vs_ledger'::text AS check_name,
    lt.true_qty AS expected_value,
    lp.running_quantity AS actual_value,
    (lp.running_quantity - lt.true_qty) AS diff,
    'Projection running_quantity diverges from cumulative ledger sum'::text AS details
  FROM latest_projection lp
  JOIN ledger_totals lt ON lt.variant_id = lp.variant_id
  JOIN public.product_variants pv ON pv.id = lp.variant_id
  WHERE lp.running_quantity IS DISTINCT FROM lt.true_qty

  UNION ALL

  -- Check 3: Missing valuation records for movements
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'unvalued_movement'::text AS check_name,
    1::numeric AS expected_value,
    0::numeric AS actual_value,
    -1::numeric AS diff,
    ('Movement ' || sm.id::text || ' has no row in stock_movement_costs')::text AS details
  FROM public.stock_movements sm
  JOIN public.product_variants pv ON pv.id = sm.variant_id
  LEFT JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
  WHERE smc.movement_id IS NULL

  UNION ALL

  -- Check 4: variant_costs cache vs latest projection running_avg_cost
  WITH latest_projection AS (
    SELECT DISTINCT ON (smc.variant_id)
      smc.variant_id,
      smc.running_avg_cost
    FROM public.stock_movement_costs smc
    ORDER BY smc.variant_id, smc.posting_date DESC, smc.created_at DESC, smc.movement_id DESC
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'cache_vs_projection'::text AS check_name,
    ROUND(lp.running_avg_cost, 2) AS expected_value,
    vc.cost_price AS actual_value,
    (vc.cost_price - ROUND(lp.running_avg_cost, 2)) AS diff,
    'variant_costs.cost_price cache is stale relative to latest projection running average'::text AS details
  FROM public.variant_costs vc
  JOIN latest_projection lp ON lp.variant_id = vc.variant_id
  JOIN public.product_variants pv ON pv.id = vc.variant_id
  WHERE vc.cost_price IS DISTINCT FROM ROUND(lp.running_avg_cost, 2);
END;
$$;


-- ─── 5. set_variant_stock_safe RPC (with set_product_stock_safe alias) ───────
CREATE OR REPLACE FUNCTION set_variant_stock_safe(
  p_variant_id uuid,
  p_target_stock numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_adjustment',
  p_note text DEFAULT NULL
)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_variant_id uuid;
  v_current_on_hand numeric;
  v_delta numeric;
  v_reason text;
  v_resulting_on_hand numeric;
BEGIN
  IF p_target_stock < 0 THEN
    RAISE EXCEPTION 'Target stock cannot be negative' USING ERRCODE = 'ST001';
  END IF;

  -- 1. Try to find variant by variant id with exclusive row lock
  SELECT id, on_hand INTO v_variant_id, v_current_on_hand
  FROM public.product_variants
  WHERE id = p_variant_id
  FOR UPDATE;

  -- 2. If not found by variant id, fall back to default variant of product by product id
  IF v_variant_id IS NULL THEN
    SELECT id, on_hand INTO v_variant_id, v_current_on_hand
    FROM public.product_variants
    WHERE product_id = p_variant_id AND is_default = true
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found for identifier %', p_variant_id USING ERRCODE = 'ST002';
  END IF;

  v_delta := p_target_stock - v_current_on_hand;

  IF v_delta <> 0 THEN
    v_reason := COALESCE(p_reason, CASE WHEN v_delta > 0 THEN 'manual_adjustment' ELSE 'damage_write_off' END);
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, actor_id, note
    ) VALUES (
      v_variant_id, v_delta, v_reason::stock_movement_reason, 'manual', p_actor_id, COALESCE(p_note, 'Stock adjustment to ' || p_target_stock)
    );
  END IF;

  SELECT on_hand INTO v_resulting_on_hand
  FROM public.product_variants
  WHERE id = v_variant_id;

  RETURN v_resulting_on_hand;
END;
$$;

-- Aliased wrapper maintaining backward compatibility
CREATE OR REPLACE FUNCTION set_product_stock_safe(
  p_product_id uuid,
  p_target_stock numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_adjustment',
  p_note text DEFAULT NULL
)
RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN
  RETURN set_variant_stock_safe(p_product_id, p_target_stock, p_actor_id, p_reason, p_note);
END;
$$;


-- ─── 6. Weighted-Average Cost Recompute Engine ────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_variant_cost(
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

      IF v_basis_qty <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := v_m.quantity_delta;
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
          v_basis_qty := v_m.quantity_delta;
        ELSE
          v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
          v_basis_qty := v_basis_qty + v_m.quantity_delta;
        END IF;
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


-- ─── 7. Atomic Posting RPC: post_goods_receipt ────────────────────────────────
CREATE OR REPLACE FUNCTION post_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_receipt record;
  v_tx_id uuid := gen_random_uuid();
  v_var record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Actor ID is required to attribute movements' USING ERRCODE = 'ST007';
  END IF;

  -- 1. Lock receipt and verify status
  SELECT * INTO v_receipt
  FROM public.goods_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found: %', p_receipt_id USING ERRCODE = 'P0002';
  END IF;

  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'Receipt % is already % and cannot be posted', p_receipt_id, v_receipt.status
      USING ERRCODE = 'ST003';
  END IF;

  -- 2. Verify lines exist and costs are populated
  IF NOT EXISTS (SELECT 1 FROM public.goods_receipt_lines WHERE receipt_id = p_receipt_id) THEN
    RAISE EXCEPTION 'Cannot post receipt %: no line items exist', p_receipt_id USING ERRCODE = 'ST004';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.goods_receipt_lines grl
    LEFT JOIN public.goods_receipt_line_costs grlc ON grlc.line_id = grl.id
    WHERE grl.receipt_id = p_receipt_id AND (grlc.unit_cost IS NULL OR grlc.unit_cost < 0)
  ) THEN
    RAISE EXCEPTION 'Cannot post receipt %: every line must carry a non-negative unit cost', p_receipt_id
      USING ERRCODE = 'ST005';
  END IF;

  -- 3. Atomically insert stock_movements for all lines
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id,
    note,
    posting_date,
    transaction_id
  )
  SELECT
    grl.variant_id,
    grl.quantity,
    'goods_receipt'::stock_movement_reason,
    'goods_receipt_line',
    grl.id::text,
    p_actor_id,
    COALESCE(v_receipt.note, 'Goods receipt ' || v_receipt.receipt_number),
    v_receipt.posting_date,
    v_tx_id
  FROM public.goods_receipt_lines grl
  WHERE grl.receipt_id = p_receipt_id
  ORDER BY grl.sort_order ASC, grl.id ASC;

  -- 4. Execute scoped recompute once per distinct variant from receipt.posting_date
  FOR v_var IN (
    SELECT DISTINCT variant_id 
    FROM public.goods_receipt_lines 
    WHERE receipt_id = p_receipt_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_receipt.posting_date);
  END LOOP;

  -- 5. Mark receipt posted
  UPDATE public.goods_receipts
  SET status = 'posted',
      transaction_id = v_tx_id,
      posted_by = p_actor_id,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_receipt_id;
END;
$$;


-- ─── 8. Atomic Reversal RPC: reverse_goods_receipt ────────────────────────────
CREATE OR REPLACE FUNCTION reverse_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_reason text DEFAULT 'Clerical error correction'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_receipt record;
  v_rev_tx_id uuid := gen_random_uuid();
  v_var record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Actor ID is required to attribute movements' USING ERRCODE = 'ST007';
  END IF;

  SELECT * INTO v_receipt
  FROM public.goods_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found: %', p_receipt_id USING ERRCODE = 'P0002';
  END IF;

  IF v_receipt.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted receipts can be reversed; receipt is %', v_receipt.status
      USING ERRCODE = 'ST006';
  END IF;

  -- Pre-flight check: ensure goods have not been consumed before attempting reversal (F4)
  FOR v_var IN (
    SELECT
      sm.variant_id,
      pv.sku,
      SUM(sm.quantity_delta) AS received_qty,
      pv.on_hand
    FROM public.stock_movements sm
    JOIN public.product_variants pv ON pv.id = sm.variant_id
    WHERE sm.transaction_id = v_receipt.transaction_id
    GROUP BY sm.variant_id, pv.sku, pv.on_hand
  ) LOOP
    IF v_var.on_hand < v_var.received_qty THEN
      RAISE EXCEPTION 'Cannot reverse receipt %: variant % (SKU: %) has % units already consumed (% on hand, % received)',
        v_receipt.receipt_number,
        v_var.variant_id,
        COALESCE(v_var.sku, 'N/A'),
        (v_var.received_qty - v_var.on_hand),
        v_var.on_hand,
        v_var.received_qty
        USING ERRCODE = 'ST008';
    END IF;
  END LOOP;

  -- Insert offsetting return_to_supplier movements linked to original movements
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id,
    note,
    posting_date,
    transaction_id,
    correlation_id
  )
  SELECT
    sm.variant_id,
    -sm.quantity_delta,
    'return_to_supplier'::stock_movement_reason,
    'goods_receipt_line',
    sm.reference_id,
    p_actor_id,
    'Reversal of receipt ' || v_receipt.receipt_number || ': ' || p_reason,
    v_receipt.posting_date,
    v_rev_tx_id,
    sm.transaction_id
  FROM public.stock_movements sm
  WHERE sm.transaction_id = v_receipt.transaction_id;

  -- Recompute affected variants from posting_date forward
  FOR v_var IN (
    SELECT DISTINCT variant_id
    FROM public.stock_movements
    WHERE transaction_id = v_receipt.transaction_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_receipt.posting_date);
  END LOOP;

  -- Mark receipt reversed
  UPDATE public.goods_receipts
  SET status = 'reversed',
      updated_at = now()
  WHERE id = p_receipt_id;
END;
$$;


-- ─── 9. Granularity-Corrected Margin Report RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION get_margin_report(
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
      sm.id AS movement_id,
      sm.variant_id,
      sm.posting_date,
      sm.quantity_delta,
      sm.reason,
      sm.reference_type,
      sm.reference_id,
      smc.unit_cost AS cogs_unit_cost,
      smc.total_cost AS cogs_total
    FROM public.stock_movements sm
    JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
    WHERE sm.posting_date >= p_start_date AND sm.posting_date < p_end_date
      AND sm.reason IN ('online_sale', 'counter_sale', 'customer_return')
  ),
  order_variant_unit_prices AS (
    SELECT
      oi.order_id,
      oi.variant_id,
      SUM(oi.line_total)::numeric / NULLIF(SUM(oi.quantity), 0) AS weighted_unit_price
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelled', 'refused_at_delivery')
    GROUP BY oi.order_id, oi.variant_id
  ),
  movement_revenue AS (
    SELECT
      ms.movement_id,
      ms.variant_id,
      ms.quantity_delta,
      ms.reason,
      ms.cogs_total,
      (ms.reference_type = 'order' AND ovup.weighted_unit_price IS NOT NULL) AS is_priced,
      CASE
        WHEN ms.reason IN ('online_sale', 'counter_sale') AND ms.reference_type = 'order' THEN
          COALESCE(ovup.weighted_unit_price * ABS(ms.quantity_delta), 0)
        WHEN ms.reason = 'customer_return' AND ms.reference_type = 'order' THEN
          -COALESCE(ovup.weighted_unit_price * ABS(ms.quantity_delta), 0)
        ELSE 0
      END AS revenue_amount
    FROM movement_sales ms
    LEFT JOIN order_variant_unit_prices ovup
      ON ms.reference_type = 'order'
     AND ovup.order_id = ms.reference_id::uuid
     AND ovup.variant_id = ms.variant_id
  ),
  aggregated_metrics AS (
    SELECT
      mr.variant_id,
      SUM(CASE 
        WHEN mr.is_priced AND mr.reason IN ('online_sale', 'counter_sale') THEN -mr.quantity_delta 
        WHEN mr.is_priced AND mr.reason = 'customer_return' THEN -mr.quantity_delta 
        ELSE 0 
      END) AS net_units_sold,
      SUM(CASE 
        WHEN mr.is_priced AND mr.reason IN ('online_sale', 'counter_sale') THEN mr.cogs_total 
        WHEN mr.is_priced AND mr.reason = 'customer_return' THEN -mr.cogs_total 
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
    pv.id AS variant_id,
    pv.sku,
    p.id AS product_id,
    p.title AS product_title,
    c.id AS category_id,
    c.name AS category_name,
    COALESCE(am.total_revenue, 0) AS revenue,
    COALESCE(am.total_cogs, 0) AS cogs,
    COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0) AS gross_margin,
    CASE 
      WHEN COALESCE(am.total_revenue, 0) > 0 
      THEN ROUND(((COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0)) / am.total_revenue) * 100, 2)
      ELSE 0 
    END AS margin_percent,
    COALESCE(am.net_units_sold, 0) AS units_sold,
    COALESCE(am.unpriced_units_out, 0) AS unpriced_units_out
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN aggregated_metrics am ON am.variant_id = pv.id
  WHERE (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (
      (am.net_units_sold IS NOT NULL AND am.net_units_sold <> 0) 
      OR (am.total_revenue IS NOT NULL AND am.total_revenue <> 0)
      OR (am.unpriced_units_out IS NOT NULL AND am.unpriced_units_out <> 0)
    )
  ORDER BY gross_margin DESC;
END;
$$;


-- ─── 10. Execute Privileges for Service Role RPCs ─────────────────────────────
-- Revoke execution from public/anon/authenticated to block direct PostgREST calls.
-- Grant execution strictly to service_role; Express routes handle JWT authentication,
-- requireAdmin authorization, and audit logging before invoking with service credentials.
REVOKE EXECUTE ON FUNCTION public.rebuild_on_hand(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_on_hand(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.verify_stock_integrity() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_stock_integrity() TO service_role;

REVOKE EXECUTE ON FUNCTION public.recompute_variant_cost(uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_variant_cost(uuid, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.post_goods_receipt(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_goods_receipt(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reverse_goods_receipt(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_goods_receipt(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_margin_report(timestamptz, timestamptz, uuid) TO service_role;

