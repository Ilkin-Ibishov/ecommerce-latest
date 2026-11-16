-- =============================================================================
-- Migration: M4 availability view with track_stock and NULL available_quantity
-- Timestamp: 20261113231020_m4_availability_view_track_stock.sql
-- Source: supabase/migrations/20261104184000_m2c_availability_view.sql
-- Description:
--   CREATE OR REPLACE VIEW product_variant_availability with the eight existing
--   columns in their existing order and track_stock last (audit B2).
--   available_quantity is NULL when track_stock = false (audit m1).
--   No DROP VIEW: product_variant_public_availability depends on it.
-- =============================================================================

CREATE OR REPLACE VIEW public.product_variant_availability AS
SELECT
  pv.id AS variant_id,
  pv.product_id,
  pv.sku,
  pv.price,
  pv.on_hand,
  COALESCE(r.active_reserved, 0)::numeric(12,3) AS reserved_quantity,
  (CASE WHEN pv.track_stock = false THEN NULL
        ELSE GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0)) END)::numeric(12,3) AS available_quantity,
  CASE
    WHEN pv.track_stock = false THEN 0::numeric(12,3)
    ELSE GREATEST(0, COALESCE(r.active_reserved, 0) - pv.on_hand)::numeric(12,3)
  END AS deficit_quantity,
  pv.track_stock
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
