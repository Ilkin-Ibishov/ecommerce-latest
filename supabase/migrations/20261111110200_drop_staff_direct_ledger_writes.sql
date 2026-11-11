-- Migration: remove the two staff policies that let a client token change stock
-- without going through Express.
--
-- "Movements: staff/admin insert" (20261102100000, granted to public): no client
-- writes stock_movements directly; every write goes through Express with the
-- service-role client or a definer function. The policy only let a staff token
-- forge ledger rows through PostgREST.
-- "Reservations: staff update" (20261104180000): let a staff token set
-- status = 'fulfilled' directly, so the unit never left stock. Express updates
-- reservations with the service-role client (routes/admin/reservations.ts).
-- Staff and admin keep read access; admin keeps "Reservations: admin all".

DROP POLICY IF EXISTS "Movements: staff/admin insert" ON public.stock_movements;
DROP POLICY IF EXISTS "Reservations: staff update" ON public.reservations;
