-- Migration: ensure_product_categories
-- Ensures the product_categories join table exists with proper RLS policies.
-- Idempotent: safe to run on databases that already have the table.

-- 1. Create the table (skip if already exists)
CREATE TABLE IF NOT EXISTS public.product_categories (
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

-- 2. Enable RLS (idempotent — no error if already enabled)
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- 3. Public read policy (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_categories'
      AND policyname = 'ProdCats: public read'
  ) THEN
    CREATE POLICY "ProdCats: public read"
      ON public.product_categories
      FOR SELECT
      USING (true);
  END IF;
END
$$;

-- 4. Admin write policy (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_categories'
      AND policyname = 'ProdCats: admin write'
  ) THEN
    CREATE POLICY "ProdCats: admin write"
      ON public.product_categories
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid() AND u.role = 'admin'
        )
      );
  END IF;
END
$$;
