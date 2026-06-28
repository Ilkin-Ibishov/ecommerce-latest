CREATE TABLE IF NOT EXISTS store_settings (
  key   text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO store_settings (key, value, description) VALUES
  ('free_delivery_threshold', '100', 'Minimum order total (AZN) for free delivery'),
  ('low_stock_threshold', '10', 'Products with stock below this appear in the low stock alert'),
  ('installment_months', '12', 'Number of installment months shown on product pages'),
  ('contact_phone', '+994 55 619 59 07', 'Contact phone shown in footer'),
  ('contact_email', 'info@ilkelectronics.com', 'Contact email shown in footer'),
  ('contact_city', 'Bakı, Azərbaycan', 'Contact address shown in footer'),
  ('instagram_url', 'https://instagram.com', 'Instagram profile URL'),
  ('facebook_url', 'https://facebook.com', 'Facebook page URL'),
  ('telegram_url', 'https://t.me', 'Telegram channel URL'),
  ('announcement_message_az', '100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma · Bütün Azərbaycan üzrə', 'Announcement bar text (Azerbaijani)'),
  ('announcement_message_ru', 'Бесплатная доставка для заказов от 100 AZN · По всему Азербайджану', 'Announcement bar text (Russian)'),
  ('announcement_message_en', 'Free Delivery on orders over 100 AZN · Across all Azerbaijan', 'Announcement bar text (English)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_settings' AND policyname = 'Public read store_settings') THEN
    CREATE POLICY "Public read store_settings" ON store_settings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_settings' AND policyname = 'Admin write store_settings') THEN
    CREATE POLICY "Admin write store_settings" ON store_settings FOR ALL USING (
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );
  END IF;
END$$;
