-- Migration: create pages table for CMS page management
-- Stores CMS page metadata with navigation flags and system page support.
-- Run this in the Supabase SQL Editor for your project.

-- ─── Pages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(100) NOT NULL UNIQUE,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  published       BOOLEAN NOT NULL DEFAULT false,
  show_in_header  BOOLEAN NOT NULL DEFAULT false,
  show_in_footer  BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 999),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slug format constraint: lowercase alphanumeric with hyphens
ALTER TABLE public.pages
  ADD CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

-- Pre-seed system pages
INSERT INTO public.pages (slug, is_system, published, show_in_footer, sort_order) VALUES
  ('delivery', true, true, true, 0),
  ('returns', true, true, true, 1),
  ('terms', true, true, true, 2)
  ON CONFLICT (slug) DO NOTHING;

-- RLS: public read for published pages
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pages: public read published"
  ON public.pages
  FOR SELECT
  USING (published = true);

CREATE POLICY "Pages: admin all"
  ON public.pages
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- Auto-update updated_at on changes (uses existing set_updated_at function)
CREATE TRIGGER trg_pages_updated_at
  BEFORE UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
