-- =============================================================================
-- Migration: M4 Track Stock Enforcement Trigger & Availability View
-- Timestamp: 20261113220000_m4_track_stock_trigger.sql
-- Description:
--   1. Enforces track_stock in trg_apply_stock_movement, raising ST030 if an insert
--      to stock_movements is attempted for a non-tracked variant.
--   2. Updates product_variant_availability view to expose track_stock and report
--      unlimited availability (999999) and 0 deficit for non-tracked variants.
-- =============================================================================

-- ─── 1. Enhanced Apply Movement Trigger with track_stock Check ───────────────
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
  IF NEW.reason = 'online_sale' AND NOT v_allow_negative THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_reserved
    FROM public.reservations
    WHERE variant_id = NEW.variant_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

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

-- ─── 2. Updated Availability View Exposing track_stock ───────────────────────
CREATE OR REPLACE VIEW public.product_variant_availability AS
SELECT
  pv.id AS variant_id,
  pv.product_id,
  pv.sku,
  pv.price,
  pv.on_hand,
  pv.track_stock,
  CASE
    WHEN pv.track_stock = false THEN 0::numeric(12,3)
    ELSE COALESCE(r.active_reserved, 0)::numeric(12,3)
  END AS reserved_quantity,
  CASE
    WHEN pv.track_stock = false THEN 999999::numeric(12,3)
    ELSE GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0))::numeric(12,3)
  END AS available_quantity,
  CASE
    WHEN pv.track_stock = false THEN 0::numeric(12,3)
    ELSE GREATEST(0, COALESCE(r.active_reserved, 0) - pv.on_hand)::numeric(12,3)
  END AS deficit_quantity
FROM public.product_variants pv
LEFT JOIN (
  SELECT variant_id, SUM(quantity) AS active_reserved
  FROM public.reservations
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
  GROUP BY variant_id
) r ON r.variant_id = pv.id;

ALTER VIEW public.product_variant_availability OWNER TO postgres;
REVOKE ALL ON public.product_variant_availability FROM public, anon, authenticated;
GRANT SELECT ON public.product_variant_availability TO service_role;
