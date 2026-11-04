-- ─── M2c C3: Reservations View with Unified effective_status ────────────
-- Computes effective_status once in the database:
-- 'released' and 'fulfilled' pass through.
-- 'active' with expires_at in the past becomes 'expired'.
-- Otherwise 'active'.
-- Stored status remains intact; nothing writes 'expired' automatically.

CREATE OR REPLACE VIEW public.reservations_view AS
SELECT
  r.id,
  r.reservation_number,
  r.variant_id,
  r.quantity,
  r.customer_name,
  r.customer_phone,
  r.hold_type,
  r.status,
  CASE
    WHEN r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now() THEN 'expired'
    ELSE r.status
  END AS effective_status,
  r.agreed_price,
  r.paid_amount,
  r.notes,
  r.expires_at,
  r.created_by,
  r.fulfilled_by,
  r.fulfilled_at,
  r.released_by,
  r.released_at,
  r.release_reason,
  r.created_at,
  r.updated_at
FROM public.reservations r;

ALTER VIEW public.reservations_view OWNER TO postgres;
REVOKE ALL ON public.reservations_view FROM anon;
GRANT SELECT ON public.reservations_view TO authenticated, service_role;
