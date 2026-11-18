-- Enforce delivery fee recorded before goods move (spec §5, note §4).
-- Valid table check: status cannot be courier_assigned, shipped, or delivered while delivery_fee_azn is NULL.

ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_fee_before_dispatch
  CHECK (status NOT IN ('courier_assigned', 'shipped', 'delivered') OR delivery_fee_azn IS NOT NULL);
