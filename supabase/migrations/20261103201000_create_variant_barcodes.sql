-- Migration: Replace variant barcode column with variant_barcodes table
-- Resolves F3 & implements docs/tasks/identification-scenario-matrix.md
-- Supports S1 (unique code), S2 (shared manufacturer barcode across variants),
-- S3 (internal labels), and S4 (multiple barcodes for one variant).

-- 1. Create variant_barcodes table
CREATE TABLE IF NOT EXISTS public.variant_barcodes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  barcode      text NOT NULL,
  source       text NOT NULL DEFAULT 'manufacturer' CHECK (source IN ('manufacturer', 'internal')),
  is_primary   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Uniqueness justification: A variant cannot have the identical barcode row twice.
  -- Global uniqueness on barcode is intentionally omitted to support S2 (shared manufacturer code).
  CONSTRAINT uq_variant_barcodes_variant_barcode UNIQUE (variant_id, barcode)
);

-- Fast lookup for barcode scans
CREATE INDEX IF NOT EXISTS idx_variant_barcodes_barcode ON public.variant_barcodes(barcode);

-- Ensure at most one primary barcode per variant (S4: multiple codes, exactly one primary)
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_barcodes_single_primary
  ON public.variant_barcodes(variant_id) WHERE is_primary = true;

-- 2. Backfill existing barcodes from product_variants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'barcode'
  ) THEN
    INSERT INTO public.variant_barcodes (variant_id, barcode, source, is_primary)
    SELECT id, trim(barcode), 'manufacturer', true
    FROM public.product_variants
    WHERE barcode IS NOT NULL AND trim(barcode) <> ''
    ON CONFLICT (variant_id, barcode) DO NOTHING;
  END IF;
END;
$$;

-- 3. Drop legacy unique index on product_variants(barcode) to allow shared barcodes
DROP INDEX IF EXISTS public.idx_variants_barcode;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.variant_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variant_barcodes: staff/admin read" ON public.variant_barcodes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "variant_barcodes: admin write" ON public.variant_barcodes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "variant_barcodes: staff insert" ON public.variant_barcodes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));

CREATE POLICY "variant_barcodes: staff update" ON public.variant_barcodes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));
