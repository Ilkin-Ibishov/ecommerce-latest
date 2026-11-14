-- Migration: lookup table for payment methods (chore-counter-sale-payments spec §3.1, §16.4)
-- RLS enabled; admin/staff read, no client writes.

CREATE TABLE IF NOT EXISTS public.payment_methods (
  code text PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.payment_methods (code, label, active) VALUES
  ('cash', 'Cash', true),
  ('card', 'Card', true),
  ('bank_transfer', 'Bank Transfer', true),
  ('other', 'Other', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PaymentMethods: authenticated read" ON public.payment_methods
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.payment_methods FROM public, anon, authenticated;
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
