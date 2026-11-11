-- Migration: allow reference_type = 'reservation' on stock_movements.
--
-- fulfil_reservation (20261104182000) inserts its counter_sale movement with
-- reference_type = 'reservation', but the CHECK from 20261104100000 allows only
-- order, goods_receipt_line, purchase_order, stocktake, manual. Every deposit
-- pick-up therefore failed with a check violation and rolled back.
-- 'counter_sale' for M3's till is left to M3, which defines that reference.

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (reference_type IN ('order', 'goods_receipt_line', 'purchase_order', 'stocktake', 'manual', 'reservation'));
