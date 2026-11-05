-- M2c View Security Fix
-- V1: reservations_view bypasses RLS and is granted to authenticated.
-- Enabling security_invoker causes the view to evaluate underlying reservations table RLS
-- as the calling role: staff/admin see rows; customers see none.
ALTER VIEW public.reservations_view SET (security_invoker = true);
