-- Migration: close client access to the two M2c SECURITY DEFINER functions.
--
-- 20261104181000 and 20261104182000 revoked EXECUTE only FROM public. Supabase's default
-- privileges grant EXECUTE on new public functions to anon and authenticated directly, so
-- both stayed callable through /rest/v1/rpc/ with the public anon key (verified live on the
-- test project 2026-11-11 with has_function_privilege):
--   - decrement_order_stock: anyone could post online_sale movements and drain stock.
--   - fulfil_reservation: also granted to authenticated; takes the actor as a parameter and
--     checks no role, so any shopper could fulfil any reservation under any staff name.
-- Express calls both with the service-role client (routes/orders.ts,
-- routes/admin/reservations.ts), so service_role is the only caller that needs EXECUTE.
-- Same pattern as M2a/M2b (20261104110000, 20261104140000).

REVOKE EXECUTE ON FUNCTION public.decrement_order_stock(uuid, jsonb, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_order_stock(uuid, jsonb, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_reservation(uuid, uuid, numeric) TO service_role;
