-- Migration: backfill existing counter_sales into counter_sale_payments (chore-counter-sale-payments spec §3.5)
-- Creates one payment row per sale with method = payment_method and amount = total_amount.
-- Re-runnable: WHERE NOT EXISTS checks if payments already exist for the sale.
-- Succeeds on sales of every status (posted, needs_owner, voided).

INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)
SELECT
  cs.id,
  cs.payment_method,
  cs.total_amount,
  cs.created_at
FROM public.counter_sales cs
WHERE NOT EXISTS (
  SELECT 1 FROM public.counter_sale_payments p WHERE p.sale_id = cs.id
);
