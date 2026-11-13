-- =============================================================================
-- Migration: M4 Store Settings for Stock Signals
-- Timestamp: 20261113220100_m4_store_settings_signals.sql
-- Description:
--   Seeds operational parameters into store_settings for dead stock,
--   reorder suggestions target horizon, trailing window, and minimum sales count.
-- =============================================================================

INSERT INTO public.store_settings (key, value, description) VALUES
  ('dead_stock_days', '90', 'Trailing days with zero sales before stock is flagged as not selling'),
  ('reorder_target_days', '60', 'Target days of stock cover for reorder suggestions'),
  ('reorder_velocity_window_days', '28', 'Trailing window in days for calculating sales velocity'),
  ('reorder_min_sales', '3', 'Minimum distinct sales count in velocity window required for suggestion')
ON CONFLICT (key) DO NOTHING;
