-- Migration: add products.original_price for storefront sale-price display
-- Referenced across the whole storefront (ProductsPage, CategoryPage, HomePage,
-- ProductDetail, ProductGrid, QuickViewModal) for the "was X now Y" sale-price
-- UI, but the column itself was never migrated. Selecting it via PostgREST
-- 400s the entire query ("column products.original_price does not exist"),
-- which supabase-js returns as { data: null, error }. Every caller destructures
-- only `data` and never checks `error`, so the whole storefront product list
-- silently renders its empty state instead of surfacing the failure.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS original_price numeric(10,2)
  CHECK (original_price IS NULL OR original_price >= 0);
