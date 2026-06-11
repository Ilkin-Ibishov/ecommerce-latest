-- Migration: create page_translations table for CMS multilingual content
-- Stores locale-specific content for each page (title, body, SEO fields).
-- Requires: pages table must exist before running this migration.
-- Run this in the Supabase SQL Editor for your project.

-- ─── Page Translations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.page_translations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  locale           VARCHAR(2) NOT NULL CHECK (locale IN ('az', 'ru', 'en')),
  title            VARCHAR(200) NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  meta_title       VARCHAR(160),
  meta_description VARCHAR(500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, locale)
);

-- RLS: public read
ALTER TABLE public.page_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PageTranslations: public read"
  ON public.page_translations
  FOR SELECT
  USING (true);

-- Auto-update updated_at on changes (uses existing set_updated_at function)
CREATE TRIGGER trg_page_translations_updated_at
  BEFORE UPDATE ON public.page_translations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
