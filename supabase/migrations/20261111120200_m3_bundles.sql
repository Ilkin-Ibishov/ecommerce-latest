-- Migration: minimal bundles (M3 spec §10). A bundle is a named list of variants and an
-- optional owner-set price. No stock, no movement, no assembly.
-- Reads and writes go through Express with the service client; clients get admin SELECT only.

CREATE TABLE IF NOT EXISTS public.bundles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(trim(name)) > 0),
  bundle_price  numeric(10,2) CHECK (bundle_price >= 0),   -- NULL = a shortcut with no discount
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bundle_lines (
  bundle_id   uuid NOT NULL REFERENCES public.bundles(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity    integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (bundle_id, variant_id)
);

ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bundles: admin read" ON public.bundles
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "BundleLines: admin read" ON public.bundle_lines
  FOR SELECT TO authenticated USING (public.is_admin());
