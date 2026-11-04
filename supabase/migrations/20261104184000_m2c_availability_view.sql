-- ─── M2c C4: Variant Availability View with Deficit Exposure ──────────
-- Single place computes availability metrics without recomputation:
-- reserved_quantity: sum of effectively-active reservations
-- available_quantity: GREATEST(0, on_hand - reserved_quantity)
-- deficit_quantity: GREATEST(0, reserved_quantity - on_hand)

CREATE OR REPLACE VIEW public.product_variant_availability AS
SELECT
  pv.id AS variant_id,
  pv.product_id,
  pv.sku,
  pv.price,
  pv.on_hand,
  COALESCE(r.active_reserved, 0)::numeric(12,3) AS reserved_quantity,
  GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0))::numeric(12,3) AS available_quantity,
  GREATEST(0, COALESCE(r.active_reserved, 0) - pv.on_hand)::numeric(12,3) AS deficit_quantity
FROM public.product_variants pv
LEFT JOIN (
  SELECT variant_id, SUM(quantity) AS active_reserved
  FROM public.reservations
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
  GROUP BY variant_id
) r ON r.variant_id = pv.id;

ALTER VIEW public.product_variant_availability OWNER TO postgres;
REVOKE ALL ON public.product_variant_availability FROM anon;
GRANT SELECT ON public.product_variant_availability TO authenticated, service_role;
