-- Migration: counter_sale_payments settlement table and integrity triggers (chore-counter-sale-payments spec §3.2, §3.3, §3.4, §5)
-- Immutable after insert: trg_counter_sale_payments_immutable raises 2BP01.
-- Sum balance: deferred constraint trigger verifies sum(amount) = counter_sales.total_amount at commit.
-- Refunds: voided sales retain original payment rows as refundable legs.

CREATE TABLE IF NOT EXISTS public.counter_sale_payments (
  sale_id    uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE RESTRICT,
  method     text NOT NULL REFERENCES public.payment_methods(code),
  amount     numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_id, method)
);

CREATE INDEX IF NOT EXISTS idx_counter_sale_payments_method
  ON public.counter_sale_payments (method);

ALTER TABLE public.counter_sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CounterSalePayments: admin read" ON public.counter_sale_payments
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.counter_sale_payments FROM public, anon, authenticated;
GRANT SELECT ON public.counter_sale_payments TO authenticated;
GRANT ALL ON public.counter_sale_payments TO service_role;

COMMENT ON TABLE public.counter_sale_payments IS
  'Settlement rows per tender method for counter sales. Immutable after insert. A refund settles against original tenders per leg; voided sales keep their payment rows.';

COMMENT ON COLUMN public.counter_sales.payment_method IS
  'DEPRECATED: Preserved for read compatibility; authoritative tender settlements live in counter_sale_payments.';

-- 1. Row immutability: updates and deletes are strictly forbidden across all roles
CREATE OR REPLACE FUNCTION public.trg_counter_sale_payments_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'counter_sale_payments is immutable: updates and deletes are forbidden' USING ERRCODE = '2BP01';
END;
$$;

DROP TRIGGER IF EXISTS counter_sale_payments_no_update_delete ON public.counter_sale_payments;
CREATE TRIGGER counter_sale_payments_no_update_delete
BEFORE UPDATE OR DELETE ON public.counter_sale_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_counter_sale_payments_immutable();

-- 2. Deferred sum constraint on counter_sale_payments
CREATE OR REPLACE FUNCTION public.chk_counter_sale_payments_sum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id uuid;
  v_expected numeric(12,2);
  v_actual numeric(12,2);
  v_count integer;
BEGIN
  v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);

  SELECT total_amount INTO v_expected
  FROM public.counter_sales
  WHERE id = v_sale_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(amount), 0), count(*) INTO v_actual, v_count
  FROM public.counter_sale_payments
  WHERE sale_id = v_sale_id;

  IF v_count = 0 OR v_actual <> v_expected THEN
    RAISE EXCEPTION 'Counter sale % payment sum (%) does not match sale total (%)',
      v_sale_id, v_actual, v_expected USING ERRCODE = 'ST027';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_counter_sale_payments_sum ON public.counter_sale_payments;
CREATE CONSTRAINT TRIGGER trg_counter_sale_payments_sum
AFTER INSERT OR UPDATE OR DELETE ON public.counter_sale_payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.chk_counter_sale_payments_sum();

-- 3. Deferred check on counter_sales insert: ensures at least one payment row exists
CREATE OR REPLACE FUNCTION public.chk_counter_sales_has_payments()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_actual numeric(12,2);
  v_count integer;
BEGIN
  SELECT COALESCE(sum(amount), 0), count(*) INTO v_actual, v_count
  FROM public.counter_sale_payments
  WHERE sale_id = NEW.id;

  IF v_count = 0 OR v_actual <> NEW.total_amount THEN
    RAISE EXCEPTION 'Counter sale % requires payment rows summing to total % (found % rows summing to %)',
      NEW.id, NEW.total_amount, v_count, v_actual USING ERRCODE = 'ST027';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_counter_sales_has_payments ON public.counter_sales;
CREATE CONSTRAINT TRIGGER trg_counter_sales_has_payments
AFTER INSERT ON public.counter_sales
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.chk_counter_sales_has_payments();
