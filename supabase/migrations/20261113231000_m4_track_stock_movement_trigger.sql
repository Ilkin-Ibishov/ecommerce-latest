-- =============================================================================
-- Migration: M4 track_stock enforcement in movement apply trigger
-- Timestamp: 20261113231000_m4_track_stock_movement_trigger.sql
-- Source: supabase/migrations/20261104190000_m2c_trigger_bypass_reasons.sql
-- Description:
--   trg_apply_stock_movement raises ST030 for track_stock = false variants.
--   No exceptions of any kind (review D2).
--   Existing negative-stock and availability branches stay exactly as they are.
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric(12,3);
  v_allow_negative boolean := false;
  v_reserved numeric(12,3) := 0;
  v_track_stock boolean;
BEGIN
  -- 1. Invariant: Stock movements are strictly prohibited for non-tracked variants
  SELECT track_stock INTO v_track_stock
  FROM public.product_variants
  WHERE id = NEW.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
  END IF;

  IF NOT v_track_stock THEN
    RAISE EXCEPTION 'Stock movements cannot be created for non-tracked variant %', NEW.variant_id
      USING ERRCODE = 'ST030';
  END IF;

  -- 2. Check tenant setting for negative stock
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

  -- 3. Availability check for online sales
  -- Reasons deliberately bypassing the availability check:
  -- counter_sale: the customer is at the till and the unit is physically present; M3 records the override
  -- stocktake_correction and opening_balance: physical observation outranks a promise
  -- damage_write_off and return_to_supplier: the unit is gone
  -- manual_adjustment: owner's explicit correction
  -- customer_return and goods_receipt: inbound movements adding stock
  IF NEW.reason = 'online_sale' AND NOT v_allow_negative THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM public.reservations
    WHERE variant_id = NEW.variant_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    -- Verify that on-hand after decrement still covers all active reservations
    IF (SELECT on_hand FROM public.product_variants WHERE id = NEW.variant_id) + NEW.quantity_delta < v_reserved THEN
      RAISE EXCEPTION 'Insufficient available stock for variant % (available: %, requested: %)',
        NEW.variant_id,
        GREATEST(0, (SELECT on_hand FROM public.product_variants WHERE id = NEW.variant_id) - v_reserved),
        -NEW.quantity_delta
        USING ERRCODE = 'ST014';
    END IF;
  END IF;

  -- 4. Apply delta to product_variants.on_hand
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
