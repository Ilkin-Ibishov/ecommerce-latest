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

-- NOTE (SEC-002, P1): the former "size_guides_admin_write" policy
-- (FOR ALL USING(true) WITH CHECK(true)) was dropped in migration
-- 20240102_sec002_drop_size_guides_world_write.sql because USING(true)/CHECK(true)
-- granted anon/authenticated full write through the anon client. Admin writes flow
-- through the service role (api-server routes/size-guides.ts), which bypasses RLS
-- and needs no client-write policy. Only the public read policy remains.
