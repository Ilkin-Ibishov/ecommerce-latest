-- M2c View Security Fix
-- V1: reservations_view bypasses RLS and is granted to authenticated.
-- Enabling security_invoker causes the view to evaluate underlying reservations table RLS
-- as the calling role: staff/admin see rows; customers see none.
ALTER VIEW public.reservations_view SET (security_invoker = true);

-- V2: product_variant_availability exposes reserved_quantity and deficit_quantity to customers.
-- Revoke from authenticated so only service_role can access the full view.
-- product_variant_public_availability remains accessible to anon and authenticated.
REVOKE ALL ON public.product_variant_availability FROM authenticated;
GRANT SELECT ON public.product_variant_availability TO service_role;
