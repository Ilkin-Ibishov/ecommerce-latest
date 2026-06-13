-- =============================================================
--  AZERBAIJAN E-COMMERCE STORE — SUPABASE SCHEMA
--  Run this in the Supabase SQL Editor to set up all tables,
--  indexes, RLS policies, triggers, functions, and FTS.
-- =============================================================

-- ─── Extensions ───────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ─── Enum: order status ───────────────────────────────────────
create type order_status as enum (
  'pending',
  'phone_verified',
  'courier_assigned',
  'shipped',
  'delivered',
  'refused_at_delivery',
  'cancelled'
);

-- ─── Users ───────────────────────────────────────────────────
create table if not exists public.users (
  id               uuid primary key references auth.users on delete cascade,
  phone            text unique,
  email            text,
  full_name        text,
  default_address  text,
  role             text not null default 'customer' check (role in ('customer', 'admin')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.users enable row level security;
create policy "Users: own row" on public.users for all using (auth.uid() = id);
create policy "Admins: all users" on public.users for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ─── Categories ──────────────────────────────────────────────
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  icon_url   text,
  parent_id  uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "Categories: public read" on public.categories for select using (true);
create policy "Categories: admin write" on public.categories for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists public.category_translations (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  lang_code   text not null check (lang_code in ('az', 'ru', 'en')),
  title       text not null,
  unique (category_id, lang_code)
);
alter table public.category_translations enable row level security;
create policy "CatTrans: public read" on public.category_translations for select using (true);
create policy "CatTrans: admin write" on public.category_translations for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ─── Products ────────────────────────────────────────────────
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  sku            text unique,
  slug           text not null unique,
  price          numeric(10,2) not null check (price >= 0),
  stock          integer not null default 0 check (stock >= 0),
  is_featured    boolean not null default false,
  is_on_sale     boolean not null default false,
  is_deal_of_day boolean not null default false,
  sort_order     integer not null default 0,
  search_vector  tsvector,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "Products: public read" on public.products for select using (true);
create policy "Products: admin write" on public.products for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create index if not exists products_sort_order_idx on public.products (sort_order);
create index if not exists products_search_vector_idx on public.products using gin (search_vector);
create index if not exists products_is_featured_idx on public.products (is_featured) where is_featured = true;
create index if not exists products_is_on_sale_idx on public.products (is_on_sale) where is_on_sale = true;
create index if not exists products_is_deal_idx on public.products (is_deal_of_day) where is_deal_of_day = true;

create table if not exists public.product_translations (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  lang_code  text not null check (lang_code in ('az', 'ru', 'en')),
  title      text not null,
  description text,
  unique (product_id, lang_code)
);
alter table public.product_translations enable row level security;
create policy "ProdTrans: public read" on public.product_translations for select using (true);
create policy "ProdTrans: admin write" on public.product_translations for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url        text not null,
  alt_text   text,
  sort_order integer not null default 0,
  source     text not null default 'paste' check (source in ('search', 'barcode', 'paste', 'upload'))
);
create unique index if not exists idx_product_images_url on public.product_images(product_id, url);
alter table public.product_images enable row level security;
create policy "ProdImages: public read" on public.product_images for select using (true);
create policy "ProdImages: admin write" on public.product_images for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists public.product_categories (
  product_id  uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (product_id, category_id)
);
alter table public.product_categories enable row level security;
create policy "ProdCats: public read" on public.product_categories for select using (true);
create policy "ProdCats: admin write" on public.product_categories for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ─── Full-Text Search (FTS) ───────────────────────────────────
-- Rebuild search_vector from all translations
create or replace function update_product_search_vector()
returns trigger language plpgsql as $$
begin
  update public.products p
  set search_vector = (
    select to_tsvector('simple',
      coalesce(string_agg(pt.title, ' '), '') || ' ' ||
      coalesce(string_agg(pt.description, ' '), '')
    )
    from public.product_translations pt
    where pt.product_id = p.id
  )
  where p.id = new.product_id;
  return new;
end;
$$;

create or replace trigger trg_product_search_vector
after insert or update on public.product_translations
for each row execute function update_product_search_vector();

-- FTS search function used by SearchPage
create or replace function search_products(query_text text, lang_code text default 'az')
returns table (
  id          uuid,
  slug        text,
  price       numeric,
  title       text,
  description text,
  rank        real
) language sql stable as $$
  select
    p.id,
    p.slug,
    p.price,
    pt.title,
    pt.description,
    ts_rank(p.search_vector, to_tsquery('simple', unaccent(query_text) || ':*')) as rank
  from public.products p
  join public.product_translations pt on pt.product_id = p.id and pt.lang_code = search_products.lang_code
  where p.search_vector @@ to_tsquery('simple', unaccent(query_text) || ':*')
  order by rank desc
  limit 50;
$$;

-- ─── Stock RPC functions ──────────────────────────────────────
-- Atomically deduct stock (returns error if insufficient)
create or replace function decrement_stock_safe(p_product_id uuid, p_qty integer)
returns void language plpgsql as $$
begin
  update public.products
  set stock = stock - p_qty,
      updated_at = now()
  where id = p_product_id and stock >= p_qty;
  if not found then
    raise exception 'Insufficient stock for product %', p_product_id;
  end if;
end;
$$;

-- Atomically increment stock (for cancellations)
create or replace function increment_stock(p_product_id uuid, p_qty integer)
returns void language plpgsql as $$
begin
  update public.products
  set stock = stock + p_qty,
      updated_at = now()
  where id = p_product_id;
end;
$$;

-- ─── OTP Rate Limiting ────────────────────────────────────────
-- Table name matches what the API server uses (otp_requests).
-- Stores a SHA-256 hash of the code — never the plain code.
create table if not exists public.otp_requests (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '10 minutes')
);
alter table public.otp_requests enable row level security;
-- Only service role can read/write OTP requests (no customer policy needed)

create index if not exists otp_requests_phone_idx on public.otp_requests (phone);
create index if not exists otp_requests_expires_idx on public.otp_requests (expires_at);

-- ─── Coupons ─────────────────────────────────────────────────
create table if not exists public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  description        text,
  discount_type      text not null check (discount_type in ('percentage', 'fixed')),
  discount_value     numeric(10,2) not null check (discount_value > 0),
  min_order_amount   numeric(10,2),
  max_uses           integer,
  max_uses_per_user  integer,
  used_count         integer not null default 0,
  scope              text not null default 'global' check (scope in ('global', 'category', 'product')),
  scope_ids          uuid[],
  is_active          boolean not null default true,
  starts_at          timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.coupons enable row level security;
create policy "Coupons: public read active" on public.coupons for select using (is_active = true);
create policy "Coupons: admin all" on public.coupons for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists public.coupon_usages (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  order_id   uuid not null,
  created_at timestamptz not null default now(),
  unique (coupon_id, user_id, order_id)
);
alter table public.coupon_usages enable row level security;
create policy "CouponUsages: own" on public.coupon_usages for select using (auth.uid() = user_id);
create policy "CouponUsages: admin" on public.coupon_usages for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ─── Cart Items ───────────────────────────────────────────────
create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  session_id text,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity   integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_owner check (user_id is not null or session_id is not null)
);
alter table public.cart_items enable row level security;
create policy "CartItems: own user" on public.cart_items for all using (auth.uid() = user_id);
-- Session-based cart is managed only by the service role (via API)

create index if not exists cart_items_user_idx on public.cart_items (user_id) where user_id is not null;
create index if not exists cart_items_session_idx on public.cart_items (session_id) where session_id is not null;

-- ─── Orders ──────────────────────────────────────────────────
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id),
  status           order_status not null default 'pending',
  customer_name    text not null,
  customer_phone   text not null,
  delivery_address text not null,
  notes            text,
  subtotal_azn     numeric(10,2) not null,
  discount_azn     numeric(10,2) not null default 0,
  total_azn        numeric(10,2) not null,
  coupon_id        uuid references public.coupons(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.orders enable row level security;
create policy "Orders: own" on public.orders for select using (auth.uid() = user_id);
create policy "Orders: admin all" on public.orders for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create index if not exists orders_user_idx on public.orders (user_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders(id) on delete cascade,
  product_id               uuid references public.products(id) on delete set null,
  product_title_snapshot   text not null,
  product_price_snapshot   numeric(10,2) not null,
  quantity                 integer not null check (quantity > 0),
  line_total               numeric(10,2) not null
);
alter table public.order_items enable row level security;
create policy "OrderItems: own via order" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
create policy "OrderItems: admin all" on public.order_items for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ─── Wishlists ───────────────────────────────────────────────
create table if not exists public.wishlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);
alter table public.wishlists enable row level security;
create policy "Wishlists: own" on public.wishlists for all using (auth.uid() = user_id);

-- ─── Comments / Reviews ──────────────────────────────────────
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  content    text not null,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
create policy "Comments: public read approved" on public.comments for select using (approved = true);
create policy "Comments: own insert" on public.comments for insert with check (auth.uid() = user_id);
create policy "Comments: admin all" on public.comments for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create index if not exists comments_product_idx on public.comments (product_id, approved);

-- ─── Notifications ───────────────────────────────────────────
create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references public.users(id) on delete set null,
  type             text not null,
  channel          text not null default 'whatsapp',
  recipient        text not null,
  payload          jsonb not null default '{}',
  status           text not null default 'pending' check (status in ('pending', 'sent', 'retrying', 'failed')),
  attempts         integer not null default 0,
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  error_message    text,
  created_at       timestamptz not null default now()
);
alter table public.notifications add column if not exists error_message text;
alter table public.notifications enable row level security;
-- Only service role accesses this table

create index if not exists notifications_status_idx on public.notifications (status) where status in ('pending', 'retrying');

-- ─── Audit Log ───────────────────────────────────────────────
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.users(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  changes    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "AuditLog: admin read" on public.audit_log for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- ─── Auto-create user profile on sign-up ─────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, phone, email, full_name, role)
  values (
    new.id,
    new.phone,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger trg_new_user
after insert on auth.users
for each row execute function handle_new_user();

-- ─── Updated-at triggers ─────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_products_updated_at
before update on public.products
for each row execute function set_updated_at();

create or replace trigger trg_orders_updated_at
before update on public.orders
for each row execute function set_updated_at();

create or replace trigger trg_cart_updated_at
before update on public.cart_items
for each row execute function set_updated_at();

create or replace trigger trg_users_updated_at
before update on public.users
for each row execute function set_updated_at();

-- ─── Storage bucket (run separately or via Supabase dashboard) ─
-- The API server creates this automatically on first upload.
-- To pre-create it: Supabase Dashboard → Storage → New Bucket
--   Name: product-images, Public: true, File size limit: 10MB
