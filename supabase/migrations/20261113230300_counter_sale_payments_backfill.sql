-- Migration: backfill existing counter_sales into counter_sale_payments (chore-counter-sale-payments spec §3.5)
-- Creates one payment row per sale with method = payment_method and amount = total_amount.
-- Re-runnable: ON CONFLICT (sale_id, method) DO NOTHING.
-- Succeeds on sales of every status (posted, needs_owner, voided).

INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)
SELECT
  cs.id,
  cs.payment_method,
  cs.total_amount,
  cs.created_at
FROM public.counter_sales cs
ON CONFLICT (sale_id, method) DO NOTHING;
