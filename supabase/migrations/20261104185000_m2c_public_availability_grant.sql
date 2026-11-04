-- ─── M2c C5: Split Public Availability View and Anon Access Boundary ───
-- product_variant_public_availability selects variant_id, product_id, available_quantity
-- from product_variant_availability and nothing else.
-- Granted to anon, authenticated, service_role.
-- Anon access revoked from product_variant_availability.

REVOKE ALL ON public.product_variant_availability FROM anon;
GRANT SELECT ON public.product_variant_availability TO authenticated, service_role;

CREATE OR REPLACE VIEW public.product_variant_public_availability AS
SELECT
  variant_id,
  product_id,
  available_quantity
FROM public.product_variant_availability;

ALTER VIEW public.product_variant_public_availability OWNER TO postgres;
GRANT SELECT ON public.product_variant_public_availability TO anon, authenticated, service_role;
