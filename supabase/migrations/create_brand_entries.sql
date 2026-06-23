-- Migration: create brand_entries table for admin-managed brand logo marquee
-- Requirements: 2.1, 2.2, 2.5

-- ─── Brand Entries ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  logo_url    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 999),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique constraint on name (Requirement 2.2)
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_entries_name_lower
  ON public.brand_entries (LOWER(name));

-- Auto-update updated_at on changes (uses existing set_updated_at function)
CREATE TRIGGER trg_brand_entries_updated_at
  BEFORE UPDATE ON public.brand_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────
ALTER TABLE public.brand_entries ENABLE ROW LEVEL SECURITY;

-- Public read access for active entries only (Requirement 5.4 - no auth required)
CREATE POLICY "brand_entries_public_read" ON public.brand_entries
  FOR SELECT
  USING (is_active = true);

-- Admin writes go through service role client (bypasses RLS)
