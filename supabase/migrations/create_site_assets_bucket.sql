-- Migration: create site-assets storage bucket for white-label asset uploads
-- Stores logos, favicons, and other branding assets.
-- Run this in the Supabase SQL Editor for your project.

-- ─── Create the site-assets bucket ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('site-assets', 'site-assets', true, 5242880)  -- 5 MB limit
ON CONFLICT (id) DO NOTHING;

-- ─── Public read policy: anyone can view/download assets ─────────
CREATE POLICY "SiteAssets: public read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'site-assets');

-- ─── Admin upload policy: only admins can insert files ───────────
CREATE POLICY "SiteAssets: admin insert"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'site-assets'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- ─── Admin update policy: only admins can update files ───────────
CREATE POLICY "SiteAssets: admin update"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'site-assets'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- ─── Admin delete policy: only admins can delete files ───────────
CREATE POLICY "SiteAssets: admin delete"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'site-assets'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );
