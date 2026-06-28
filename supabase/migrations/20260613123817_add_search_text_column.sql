-- Migration: add_search_text_column
-- Adds a trigger-populated search_text column to products for efficient
-- trigram-based substring search (used by admin panel ilike queries).
-- Uses triggers instead of a GENERATED column because PostgreSQL generated
-- columns cannot reference other tables via subqueries.

-- 1. Enable pg_trgm extension for trigram GIN indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Add search_text column (plain TEXT, NOT a generated column)
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS search_text TEXT;

-- 3. Create the function that computes and updates search_text
CREATE OR REPLACE FUNCTION public.fn_update_search_text()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_product_id uuid;
  v_slug text;
  v_brand text;
  v_az_title text;
BEGIN
  -- Determine the product_id depending on which table fired the trigger
  IF TG_TABLE_NAME = 'products' THEN
    v_product_id := NEW.id;
    v_slug := NEW.slug;
    v_brand := NEW.brand;
  ELSIF TG_TABLE_NAME = 'product_translations' THEN
    v_product_id := NEW.product_id;
    -- Fetch the product's slug and brand
    SELECT slug, brand INTO v_slug, v_brand
    FROM public.products
    WHERE id = v_product_id;
  END IF;

  -- Fetch the az title from product_translations
  SELECT title INTO v_az_title
  FROM public.product_translations
  WHERE product_id = v_product_id AND lang_code = 'az';

  -- Update the product's search_text
  UPDATE public.products
  SET search_text = v_slug || ' ' || COALESCE(v_brand, '') || ' ' || COALESCE(v_az_title, '')
  WHERE id = v_product_id;

  RETURN NEW;
END;
$$;

-- 4. Create trigger on products table (fires on INSERT or UPDATE of slug/brand)
DROP TRIGGER IF EXISTS trg_products_search_text ON public.products;
CREATE TRIGGER trg_products_search_text
AFTER INSERT OR UPDATE OF slug, brand ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_search_text();

-- 5. Create trigger on product_translations table
--    (fires on INSERT or UPDATE of title, only for az lang_code)
DROP TRIGGER IF EXISTS trg_product_translations_search_text ON public.product_translations;
CREATE TRIGGER trg_product_translations_search_text
AFTER INSERT OR UPDATE OF title ON public.product_translations
FOR EACH ROW
WHEN (NEW.lang_code = 'az')
EXECUTE FUNCTION public.fn_update_search_text();

-- 6. Backfill existing products with their computed search_text
UPDATE public.products p
SET search_text = p.slug || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(
  (SELECT pt.title FROM public.product_translations pt
   WHERE pt.product_id = p.id AND pt.lang_code = 'az'),
  ''
);

-- 7. Create GIN trigram index for efficient ilike queries
CREATE INDEX IF NOT EXISTS idx_products_search_text_trgm
ON public.products USING gin (search_text gin_trgm_ops);
