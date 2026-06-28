-- Migration: create site_settings table for white-label customization
-- Single-row table holding all branding, contact, and theme configuration.
-- Run this in the Supabase SQL Editor for your project.

-- ─── Site Settings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name     JSONB NOT NULL DEFAULT '{"az":"","ru":"","en":""}',
  colors         JSONB NOT NULL DEFAULT '{"primary":"220 70% 50%","secondary":"220 20% 20%","accent":"45 93% 47%","background":"0 0% 100%","text":"220 20% 10%","muted":"220 10% 60%"}',
  fonts          JSONB NOT NULL DEFAULT '{"heading":"Inter","body":"Inter"}',
  logo_url       TEXT,
  favicon_url    TEXT,
  contact        JSONB NOT NULL DEFAULT '{"phone":"","email":"","address":"","social_links":{}}',
  working_hours  JSONB NOT NULL DEFAULT '{"az":"","ru":"","en":""}',
  footer_text    JSONB NOT NULL DEFAULT '{"az":"","ru":"","en":""}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row constraint: only one settings row allowed
ALTER TABLE public.site_settings
  ADD CONSTRAINT single_row CHECK (id = '00000000-0000-0000-0000-000000000001');

-- Seed the single row with default values
INSERT INTO public.site_settings (id)
  VALUES ('00000000-0000-0000-0000-000000000001')
  ON CONFLICT (id) DO NOTHING;

-- RLS: public read, service role write
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SiteSettings: public read"
  ON public.site_settings
  FOR SELECT
  USING (true);

-- Auto-update updated_at on changes (uses existing set_updated_at function)
CREATE TRIGGER trg_site_settings_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
