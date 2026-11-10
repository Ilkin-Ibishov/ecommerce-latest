-- Migration: create banners table for homepage hero carousel
-- Referenced by artifacts/api-server/src/routes/banners.ts and
-- artifacts/api-server/src/routes/admin/banners.ts since the hero carousel
-- feature (b83e1df) was added, but the table itself was never migrated.

CREATE TABLE IF NOT EXISTS public.banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  subtitle    TEXT,
  image_url   TEXT,
  cta_text    TEXT,
  cta_url     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Banners: public read active"
  ON public.banners
  FOR SELECT
  USING (active = true);

CREATE POLICY "Banners: admin all"
  ON public.banners
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE TRIGGER trg_banners_updated_at
  BEFORE UPDATE ON public.banners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
