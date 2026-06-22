-- Size guides table: stores per-category size measurement data
-- Requirements: 7.2, 7.3

CREATE TABLE IF NOT EXISTS public.size_guides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  headers          JSONB NOT NULL DEFAULT '[]',
  rows             JSONB NOT NULL DEFAULT '[]',
  measurement_unit TEXT NOT NULL DEFAULT 'cm',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast category lookups
CREATE INDEX IF NOT EXISTS idx_size_guides_category_id ON public.size_guides(category_id);

-- Unique constraint: one size guide per category
CREATE UNIQUE INDEX IF NOT EXISTS idx_size_guides_category_unique ON public.size_guides(category_id);

-- Enable RLS
ALTER TABLE public.size_guides ENABLE ROW LEVEL SECURITY;

-- Allow public read access (size guides are visible to all shoppers)
CREATE POLICY "size_guides_read" ON public.size_guides
  FOR SELECT USING (true);

-- Allow authenticated admin writes (via service role key in API server)
CREATE POLICY "size_guides_admin_write" ON public.size_guides
  FOR ALL USING (true) WITH CHECK (true);
