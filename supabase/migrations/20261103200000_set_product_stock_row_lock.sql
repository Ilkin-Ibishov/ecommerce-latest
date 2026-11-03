-- Migration: Add atomic locked stock adjustment RPC
-- Resolves F1: Eliminates TOCTOU race in stock adjustment by acquiring
-- an exclusive row lock (FOR UPDATE) on the variant row, computing the exact delta,
-- and inserting into stock_movements within a single transaction.

CREATE OR REPLACE FUNCTION set_product_stock_safe(
  p_product_id uuid,
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
  WHERE id = p_product_id
  FOR UPDATE;

  -- 2. If not found by variant id, find default variant of product by product id with lock
  IF v_variant_id IS NULL THEN
    SELECT id, on_hand INTO v_variant_id, v_current_on_hand
    FROM public.product_variants
    WHERE product_id = p_product_id AND is_default = true
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found for identifier %', p_product_id USING ERRCODE = 'ST002';
  END IF;

  v_delta := p_target_stock - v_current_on_hand;

  -- 3. If delta is non-zero, insert immutable movement. The trg_apply_stock_movement
  -- trigger will fire and update on_hand under the same transaction.
  IF v_delta <> 0 THEN
    v_reason := COALESCE(p_reason, CASE WHEN v_delta > 0 THEN 'manual_adjustment' ELSE 'damage_write_off' END);
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, actor_id, note
    ) VALUES (
      v_variant_id, v_delta, v_reason, 'manual', p_actor_id, COALESCE(p_note, 'Admin stock adjustment to ' || p_target_stock)
    );
  END IF;

  -- 4. Read back and return actual resulting on_hand
  SELECT on_hand INTO v_resulting_on_hand
  FROM public.product_variants
  WHERE id = v_variant_id;

  RETURN v_resulting_on_hand;
END;
$$;
