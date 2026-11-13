-- =============================================================================
-- Migration: M4 Low Stock Notification Events Table
-- Timestamp: 20261113220200_m4_low_stock_digest_schema.sql
-- Description:
--   Creates low_stock_notification_events table to track low-stock alert state
--   per variant, suppressing repeated alerts while a variant remains low.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.low_stock_notification_events (
  variant_id                  uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
  notified_at                 timestamptz NOT NULL DEFAULT now(),
  last_notified_available     numeric(12,3) NOT NULL,
  threshold_at_notification   numeric(12,3) NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_low_stock_notification_events_notified_at
  ON public.low_stock_notification_events(notified_at DESC);

ALTER TABLE public.low_stock_notification_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'low_stock_notification_events' AND policyname = 'low_stock_notification_events_admin_all'
  ) THEN
    CREATE POLICY "low_stock_notification_events_admin_all"
      ON public.low_stock_notification_events
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;
