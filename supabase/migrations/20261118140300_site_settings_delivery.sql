-- Add delivery fee and free delivery threshold columns to site_settings (note §5).
-- Both columns are nullable (NULL = not known at checkout / no free delivery threshold).
-- Deletes the unread store_settings row.

ALTER TABLE public.site_settings
  ADD COLUMN delivery_fee_azn numeric(10,2) NULL CHECK (delivery_fee_azn >= 0),
  ADD COLUMN free_delivery_threshold_azn numeric(10,2) NULL CHECK (free_delivery_threshold_azn > 0);

DELETE FROM public.store_settings WHERE key = 'free_delivery_threshold';
