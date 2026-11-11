-- Migration: allow reference_type = 'counter_sale' for M3's till movements.
-- reference_id is the counter_sales.id (uuid text); transaction_id is the same id.

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (reference_type IN ('order', 'goods_receipt_line', 'purchase_order', 'stocktake', 'manual',
                            'reservation', 'counter_sale'));
