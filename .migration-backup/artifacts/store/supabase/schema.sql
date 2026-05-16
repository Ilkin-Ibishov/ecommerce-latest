-- ============================================================
-- Whitelabel E-Commerce Platform — Full Supabase Schema
-- Run this in your Supabase SQL Editor (Settings → SQL Editor)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending',
    'phone_verified',
    'courier_assigned',
    'shipped',
    'delivered',
    'refused_at_delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  full_name   text,
  role        text NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.otp_codes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_active ON otp_codes(phone, verified, expires_at);

-- Auto-create user profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', ''),
    'customer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CATALOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku           text NOT NULL UNIQUE,
  price         numeric(10,2) NOT NULL CHECK (price >= 0),
  stock         int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_featured   boolean NOT NULL DEFAULT false,
  is_on_sale    boolean NOT NULL DEFAULT false,
  is_deal_of_day boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  search_vector tsvector,
  slug          text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured, sort_order) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_sale ON products(is_on_sale, sort_order) WHERE is_on_sale = true;
CREATE INDEX IF NOT EXISTS idx_products_deal ON products(is_deal_of_day) WHERE is_deal_of_day = true;

CREATE TABLE IF NOT EXISTS public.product_images (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt_text    text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);

CREATE TABLE IF NOT EXISTS public.product_translations (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lang_code     text NOT NULL CHECK (lang_code IN ('az', 'ru', 'en')),
  title         text NOT NULL,
  description   text,
  search_vector tsvector,
  UNIQUE(product_id, lang_code)
);
CREATE INDEX IF NOT EXISTS idx_product_trans_search ON product_translations USING GIN(search_vector);

CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        text NOT NULL UNIQUE,
  icon_url    text,
  parent_id   uuid REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.category_translations (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id   uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  lang_code     text NOT NULL CHECK (lang_code IN ('az', 'ru', 'en')),
  title         text NOT NULL,
  UNIQUE(category_id, lang_code)
);

-- Search vector triggers
CREATE OR REPLACE FUNCTION public.products_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := setweight(to_tsvector('simple', coalesce(NEW.sku, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_search ON products;
CREATE TRIGGER trg_products_search
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

CREATE OR REPLACE FUNCTION public.product_trans_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_trans_search ON product_translations;
CREATE TRIGGER trg_product_trans_search
  BEFORE INSERT OR UPDATE ON product_translations
  FOR EACH ROW EXECUTE FUNCTION product_trans_search_vector_update();

-- ============================================================
-- COMMERCE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cart_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  text NOT NULL,
  user_id     uuid REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_session ON cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.coupons (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                text NOT NULL UNIQUE,
  description         text,
  discount_type       text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value      numeric(10,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount    numeric(10,2),
  max_uses            int,
  used_count          int NOT NULL DEFAULT 0,
  max_uses_per_user   int,
  scope               text NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'category', 'product')),
  scope_ids           uuid[],
  starts_at           timestamptz,
  expires_at          timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES public.users(id),
  status            order_status NOT NULL DEFAULT 'pending',
  total_azn         numeric(10,2) NOT NULL CHECK (total_azn >= 0),
  discount_azn      numeric(10,2) NOT NULL DEFAULT 0,
  coupon_id         uuid REFERENCES coupons(id),
  delivery_address  text NOT NULL,
  customer_phone    text NOT NULL,
  customer_name     text NOT NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id                  uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id                uuid NOT NULL REFERENCES products(id),
  product_title_snapshot    text NOT NULL,
  product_price_snapshot    numeric(10,2) NOT NULL,
  quantity                  int NOT NULL CHECK (quantity > 0),
  line_total                numeric(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  coupon_id   uuid NOT NULL REFERENCES coupons(id),
  user_id     uuid NOT NULL REFERENCES public.users(id),
  order_id    uuid NOT NULL REFERENCES orders(id),
  used_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(coupon_id, user_id, order_id)
);

-- ============================================================
-- ENGAGEMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wishlists (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.comments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  content     text NOT NULL,
  approved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_product ON comments(product_id, approved);

-- ============================================================
-- SYSTEM
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid REFERENCES public.users(id),
  type              text NOT NULL,
  channel           text NOT NULL DEFAULT 'whatsapp',
  recipient         text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
  attempts          int NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, created_at) WHERE status IN ('pending', 'retrying');

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    uuid REFERENCES public.users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  changes     jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id, created_at DESC);

-- ============================================================
-- FULL TEXT SEARCH RPC
-- ============================================================
CREATE OR REPLACE FUNCTION search_products(query_text text, lang_code text)
RETURNS TABLE(id uuid, title text, description text, price numeric, slug text, rank real) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    pt.title,
    pt.description,
    p.price,
    p.slug,
    ts_rank(pt.search_vector, plainto_tsquery('simple', query_text)) AS rank
  FROM products p
  JOIN product_translations pt ON pt.product_id = p.id AND pt.lang_code = lang_code
  WHERE
    pt.search_vector @@ plainto_tsquery('simple', query_text)
    OR pt.title ILIKE '%' || query_text || '%'
  ORDER BY rank DESC, p.sort_order ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Users: own row only
CREATE POLICY "users_own_read" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_own_update" ON public.users FOR UPDATE USING (auth.uid() = id);

-- OTP: service role only (no public access)
CREATE POLICY "otp_service_only" ON public.otp_codes USING (false);

-- Products: public read
CREATE POLICY "products_public_read" ON public.products FOR SELECT USING (true);
CREATE POLICY "products_admin_all" ON public.products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "product_images_public_read" ON public.product_images FOR SELECT USING (true);
CREATE POLICY "product_images_admin_all" ON public.product_images FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "product_trans_public_read" ON public.product_translations FOR SELECT USING (true);
CREATE POLICY "product_trans_admin_all" ON public.product_translations FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "categories_public_read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories_admin_all" ON public.categories FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "category_trans_public_read" ON public.category_translations FOR SELECT USING (true);
CREATE POLICY "category_trans_admin_all" ON public.category_translations FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- Cart: user's own session
CREATE POLICY "cart_own_read" ON public.cart_items FOR SELECT USING (
  user_id = auth.uid() OR session_id IS NOT NULL
);
CREATE POLICY "cart_own_write" ON public.cart_items FOR INSERT WITH CHECK (true);
CREATE POLICY "cart_own_update" ON public.cart_items FOR UPDATE USING (
  user_id = auth.uid() OR user_id IS NULL
);
CREATE POLICY "cart_own_delete" ON public.cart_items FOR DELETE USING (
  user_id = auth.uid() OR user_id IS NULL
);

-- Coupons: admin all, customers read active
CREATE POLICY "coupons_customer_read" ON public.coupons FOR SELECT USING (
  is_active = true OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "coupons_admin_write" ON public.coupons FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- Orders: own orders or admin
CREATE POLICY "orders_own_read" ON public.orders FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "orders_insert_auth" ON public.orders FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "orders_admin_update" ON public.orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "order_items_own_read" ON public.order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND
    (orders.user_id = auth.uid() OR
     EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  )
);
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT WITH CHECK (true);

-- Coupon usages: service role only
CREATE POLICY "coupon_usages_service" ON public.coupon_usages USING (false);

-- Wishlists: own only
CREATE POLICY "wishlists_own" ON public.wishlists FOR ALL USING (user_id = auth.uid());

-- Comments: public read approved, own write
CREATE POLICY "comments_public_read" ON public.comments FOR SELECT USING (
  approved = true OR user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "comments_own_insert" ON public.comments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "comments_admin_update" ON public.comments FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- Notifications: service role only
CREATE POLICY "notifications_service" ON public.notifications USING (false);

-- Audit log: admin read
CREATE POLICY "audit_admin_read" ON public.audit_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- CART CLEANUP (pg_cron — enable pg_cron extension first)
-- ============================================================
-- SELECT cron.schedule('cleanup-guest-carts', '0 2 * * *',
--   'DELETE FROM cart_items WHERE user_id IS NULL AND created_at < now() - interval ''7 days''');

-- ============================================================
-- DONE
-- ============================================================
