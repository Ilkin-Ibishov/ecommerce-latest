-- Migration: counter sale document (M3 spec §6, design note Q1).
-- Written only by post_counter_sale / post_pending_counter_sale / void_counter_sale
-- (service_role). Staff read through Express, which drops the owner-only flag columns;
-- clients get admin SELECT only, because RLS cannot hide columns from a staff SELECT.

CREATE SEQUENCE IF NOT EXISTS public.counter_sale_number_seq;

CREATE TABLE IF NOT EXISTS public.counter_sales (
  id                  uuid PRIMARY KEY,                      -- client-generated idempotency key
  sale_number         bigint NOT NULL UNIQUE DEFAULT nextval('public.counter_sale_number_seq'),
  payload_hash        text NOT NULL,
  sold_at             timestamptz NOT NULL,                  -- device clock, receipt only
  posting_date        timestamptz NOT NULL,
  payment_method      text NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  bundle_discount     numeric(12,2) NOT NULL DEFAULT 0 CHECK (bundle_discount >= 0),
  owner_discount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (owner_discount >= 0),
  total_amount        numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  displayed_total     numeric(12,2) NOT NULL,
  total_mismatch      boolean NOT NULL DEFAULT false,
  note                text,
  cashier_id          uuid NOT NULL REFERENCES public.users(id),
  posted_by           uuid NOT NULL REFERENCES public.users(id),
  status              text NOT NULL CHECK (status IN ('posted', 'needs_owner', 'voided')),
  needs_owner_reason  text,
  resolved_by         uuid REFERENCES public.users(id),
  resolved_at         timestamptz,
  voided_by           uuid REFERENCES public.users(id),
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_counter_void_attribution CHECK (
    status <> 'voided' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL
                           AND void_reason IS NOT NULL AND char_length(trim(void_reason)) > 0)),
  CONSTRAINT chk_counter_needs_owner_reason CHECK (status <> 'needs_owner' OR needs_owner_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_counter_sales_posting_date ON public.counter_sales (posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_counter_sales_needs_owner ON public.counter_sales (created_at)
  WHERE status = 'needs_owner';

CREATE TABLE IF NOT EXISTS public.counter_sale_lines (
  sale_id              uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE RESTRICT,
  line_no              integer NOT NULL CHECK (line_no > 0),
  variant_id           uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity             integer NOT NULL CHECK (quantity > 0),
  list_unit_price      numeric(10,2) NOT NULL,
  charged_unit_price   numeric(10,2) NOT NULL CHECK (charged_unit_price >= 0),
  bundle_id            uuid REFERENCES public.bundles(id) ON DELETE RESTRICT,
  net_line_total       numeric(12,2) NOT NULL CHECK (net_line_total >= 0),
  price_mismatch       boolean NOT NULL DEFAULT false,
  reservation_override boolean NOT NULL DEFAULT false,
  posted_after_count   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sale_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_counter_sale_lines_variant ON public.counter_sale_lines (variant_id);

ALTER TABLE public.counter_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counter_sale_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CounterSales: admin read" ON public.counter_sales
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "CounterSaleLines: admin read" ON public.counter_sale_lines
  FOR SELECT TO authenticated USING (public.is_admin());
