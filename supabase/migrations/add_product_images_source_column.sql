-- Add source column to product_images table
-- Tracks how each image was sourced: search, barcode, paste, or upload
-- Default 'paste' ensures backward compatibility with existing rows

ALTER TABLE public.product_images
  ADD COLUMN source TEXT NOT NULL DEFAULT 'paste'
  CHECK (source IN ('search', 'barcode', 'paste', 'upload'));

-- Prevent duplicate URLs per product
CREATE UNIQUE INDEX idx_product_images_url ON public.product_images(product_id, url);
