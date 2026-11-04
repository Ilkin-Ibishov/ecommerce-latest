-- ─── M2c C6: Enhanced trg_apply_stock_movement with Availability Guard ───────
-- Availability guard checks available stock for online sales:
--   on_hand + quantity_delta >= active_reservations
--
-- Reasons deliberately bypassing the availability check (documented per C6):
-- counter_sale: the customer is at the till and the unit is physically present; M3 records the override
-- stocktake_correction and opening_balance: physical observation outranks a promise
-- damage_write_off and return_to_supplier: the unit is gone
-- manual_adjustment: owner's explicit correction
-- customer_return and goods_receipt: inbound movements adding stock

CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric(12,3);
  v_allow_negative boolean := false;
  v_reserved numeric(12,3) := 0;
BEGIN
  -- Check tenant setting for negative stock
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

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
