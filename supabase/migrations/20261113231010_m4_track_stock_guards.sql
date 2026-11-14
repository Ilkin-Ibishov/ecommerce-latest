-- =============================================================================
-- Migration: M4 track_stock transition guard and stocktake line guard
-- Timestamp: 20261113231010_m4_track_stock_guards.sql
-- Description:
--   1. trg_guard_track_stock_change on product_variants:
--      Guards true -> false switch:
--      - ST031 if on_hand <> 0
--      - ST032 if variant is on an open stocktake (status IN ('draft', 'in_progress'))
--      - ST033 if any reservation has status = 'active' (no expires_at test per D3)
--   2. trg_guard_stocktake_lines_track_stock on stocktake_lines:
--      - ST034 if inserting a non-tracked variant onto a stocktake line
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_guard_track_stock_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.track_stock = true AND NEW.track_stock = false THEN
    IF OLD.on_hand <> 0 THEN
      RAISE EXCEPTION 'Cannot disable stock tracking for variant % with non-zero on_hand (%)',
        OLD.id, OLD.on_hand USING ERRCODE = 'ST031';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stocktake_lines sl
      JOIN public.stocktakes st ON st.id = sl.stocktake_id
      WHERE sl.variant_id = OLD.id AND st.status IN ('draft', 'in_progress')
    ) THEN
      RAISE EXCEPTION 'Cannot disable stock tracking for variant % on active stocktake',
        OLD.id USING ERRCODE = 'ST032';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.variant_id = OLD.id AND r.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Cannot disable stock tracking for variant % with active reservations',
        OLD.id USING ERRCODE = 'ST033';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_variant_track_stock ON public.product_variants;
CREATE TRIGGER trg_guard_variant_track_stock
  BEFORE UPDATE OF track_stock ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_track_stock_change();

CREATE OR REPLACE FUNCTION public.trg_guard_stocktake_lines_track_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_track_stock boolean;
BEGIN
  SELECT track_stock INTO v_track_stock
  FROM public.product_variants
  WHERE id = NEW.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
  END IF;

  IF NOT v_track_stock THEN
    RAISE EXCEPTION 'Cannot add non-tracked variant % to stocktake line', NEW.variant_id
      USING ERRCODE = 'ST034';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stocktake_lines_track_stock ON public.stocktake_lines;
CREATE TRIGGER trg_guard_stocktake_lines_track_stock
  BEFORE INSERT ON public.stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_stocktake_lines_track_stock();
