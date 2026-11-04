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
  role             text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.users enable row level security;

-- SEC-005 (P2): recursion-safe admin predicate. security definer + stable + a
-- fixed search_path, so admin RLS checks resolve without a policy on users
-- querying users. Defined here (after the users table exists, before the
-- in-scope policies that reference it). It replaces the per-table inline
-- `exists (select 1 from public.users ...)` admin subquery on the IN-SCOPE
-- tables only (audit_log, pages). The ~13 cross-table admin policies below
-- remain inline (fragile-but-not-recursive — out of AC 2.5 scope, optional
-- consistency follow-up).
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  )
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- SEC-001 (P0): public.users is SELECT-only for clients. The former `for all`
-- own-row policy (live: users_own_update) is removed so clients cannot write the
-- users table directly; profile writes go through the authenticated /api/profile
-- endpoint (service role). Live policy name mirrored: users_own_read.
-- SEC-005 reconciliation: a previously-mirrored recursive "Admins: all users"
-- policy on public.users has been REMOVED — it does NOT exist on the live DB
-- (live public.users carries only users_own_read), so a stale recursive
-- definition is not retained here.
create policy "users_own_read" on public.users for select using (auth.uid() = id);
-- SEC-001 (b): role is never client-writable. Revoke the broad UPDATE, grant
-- UPDATE only on the two profile columns (never role/email/phone).
revoke update on public.users from authenticated;
grant update (full_name, default_address) on public.users to authenticated;
-- SEC-001 (c): defense-in-depth trigger — reject ANY role change unless the
-- caller is the service role (empty-string-safe claim read; see preflight-sec001.md).
create or replace function public.enforce_role_immutability()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
         ''
       ) = 'service_role'
       or current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;
    raise exception 'role is immutable from the client'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_users_role_immutable on public.users;
create trigger trg_users_role_immutable
  before update on public.users
  for each row
  execute function public.enforce_role_immutability();

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

-- ─── Product Variants ────────────────────────────────────── ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku              text UNIQUE,
  barcode          text,
  price            numeric(10,2) NOT NULL CHECK (price >= 0),
  on_hand          numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  unit_of_measure  text NOT NULL DEFAULT 'pcs',
  track_stock      boolean NOT NULL DEFAULT true,
  low_stock_threshold numeric(12,3) CHECK (low_stock_threshold >= 0),
  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_single_default
  ON public.product_variants(product_id) WHERE is_default = true;

-- ─── Variant Barcodes (F3 / identification scenario matrix) ──────
CREATE TABLE IF NOT EXISTS public.variant_barcodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id     uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  barcode        text NOT NULL,
  pack_quantity  numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_quantity > 0),
  pack_unit      text NOT NULL DEFAULT 'pcs',
  source         text NOT NULL DEFAULT 'manufacturer' CHECK (source IN ('manufacturer', 'internal')),
  is_primary     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_variant_barcodes_variant_barcode UNIQUE (variant_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_variant_barcodes_barcode ON public.variant_barcodes(barcode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_barcodes_single_primary ON public.variant_barcodes(variant_id) WHERE is_primary = true;
ALTER TABLE public.variant_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variant_barcodes: staff/admin read" ON public.variant_barcodes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "variant_barcodes: admin write" ON public.variant_barcodes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "variant_barcodes: staff insert" ON public.variant_barcodes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));

CREATE POLICY "variant_barcodes: staff update" ON public.variant_barcodes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id_sort
  ON public.product_variants(product_id, sort_order);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Variants: public read" ON public.product_variants FOR SELECT USING (true);
CREATE POLICY "Variants: admin write" ON public.product_variants FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
CREATE POLICY "Variants: staff insert" ON public.product_variants FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
);
CREATE POLICY "Variants: staff update" ON public.product_variants FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
);

-- Trigger: Prevent staff from modifying variant prices (resolving Minor 1)
CREATE OR REPLACE FUNCTION trg_guard_staff_price_update() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') THEN
      RAISE EXCEPTION 'Staff are not permitted to change product prices' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS product_variants_guard_price ON public.product_variants;
CREATE TRIGGER product_variants_guard_price
BEFORE UPDATE OF price ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_staff_price_update();

-- Trigger: Guard single write path for on_hand (resolving B3)
CREATE OR REPLACE FUNCTION trg_guard_variant_on_hand_update() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Direct update of product_variants.on_hand is forbidden. Changes must be recorded via stock_movements.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS product_variants_guard_on_hand ON public.product_variants;
CREATE TRIGGER product_variants_guard_on_hand
BEFORE UPDATE OF on_hand ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_variant_on_hand_update();

-- ─── 3. Variant Costs (Admin-Only Margin Secrecy) ────────────
CREATE TABLE IF NOT EXISTS public.variant_costs (
  variant_id   uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
  cost_price   numeric(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  opening_cost numeric(10,2) CHECK (opening_cost >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.variant_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VariantCosts: admin read" ON public.variant_costs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
CREATE POLICY "VariantCosts: admin write" ON public.variant_costs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- ─── 4. Option Types and Values (Normalized) ─────────────────
CREATE TABLE IF NOT EXISTS public.product_option_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);

ALTER TABLE public.product_option_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "OptionTypes: public read" ON public.product_option_types FOR SELECT USING (true);
CREATE POLICY "OptionTypes: admin/staff write" ON public.product_option_types FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

CREATE TABLE IF NOT EXISTS public.product_option_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_type_id  uuid NOT NULL REFERENCES public.product_option_types(id) ON DELETE CASCADE,
  value           text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  UNIQUE (option_type_id, value)
);

ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "OptionValues: public read" ON public.product_option_values FOR SELECT USING (true);
CREATE POLICY "OptionValues: admin/staff write" ON public.product_option_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

CREATE TABLE IF NOT EXISTS public.variant_option_values (
  variant_id       uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  option_value_id  uuid NOT NULL REFERENCES public.product_option_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, option_value_id)
);

ALTER TABLE public.variant_option_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VarOptValues: public read" ON public.variant_option_values FOR SELECT USING (true);
CREATE POLICY "VarOptValues: admin/staff write" ON public.variant_option_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- ─── 5. Stock Movement Ledger ────────────────────────────────
DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_reason') THEN
    CREATE TYPE stock_movement_reason AS ENUM (
      'goods_receipt',
      'online_sale',
      'counter_sale',
      'customer_return',
      'return_to_supplier',
      'damage_write_off',
      'stocktake_correction',
      'manual_adjustment',
      'opening_balance',
      'assembly_consume',
      'assembly_produce'
    );
  END IF;
END;
$;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id     uuid,
  quantity_delta  numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason          stock_movement_reason NOT NULL,
  reference_type  text CHECK (reference_type IN ('order', 'goods_receipt_line', 'purchase_order', 'stocktake', 'manual')),
  reference_id    text,
    actor_id        uuid REFERENCES public.users(id),
  negative_stock_override boolean NOT NULL DEFAULT false,
  note            text,
  posting_date    timestamptz NOT NULL DEFAULT now(),
  transaction_id  uuid,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_created
  ON public.stock_movements(variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_posting_date
  ON public.stock_movements(variant_id, posting_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created
  ON public.stock_movements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_posting_date
  ON public.stock_movements(posting_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_transaction_id
  ON public.stock_movements(transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_correlation_id
  ON public.stock_movements(correlation_id)
  WHERE correlation_id IS NOT NULL;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Movements: staff/admin read" ON public.stock_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);
CREATE POLICY "Movements: staff/admin insert" ON public.stock_movements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- Trigger: stock_movements is append-only
CREATE OR REPLACE FUNCTION trg_stock_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only: updates and deletes are forbidden' USING ERRCODE = '2BP01';
END;
$;

DROP TRIGGER IF EXISTS stock_movements_no_update_delete ON public.stock_movements;
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_movements_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHITECTURAL DECISION NOTE FOR M2 / TRIGGER MAINTENANCE:
-- DO NOT extend trg_apply_stock_movement (the AFTER INSERT trigger) to compute cost.
-- The trigger sees insert order, not business order.
-- Cost belongs in a replay projection keyed on posting_date, which at typical shop
-- volume (hundreds of variants) executes in milliseconds.
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: Atomic quantity pairing on stock_movements insert
-- NOTE: Uses distinct custom SQLSTATE error codes in unassigned class 'ST':
--   ST001: Insufficient stock for variant
--   ST002: Variant not found
CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE
  v_new_stock numeric(12,3);
  v_allow_negative boolean := false;
BEGIN
  -- Check tenant setting for negative stock
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative
  FROM public.site_settings
  LIMIT 1;

  IF v_allow_negative THEN
    UPDATE public.product_variants
    SET on_hand = on_hand + NEW.quantity_delta,
        updated_at = now()
    WHERE id = NEW.variant_id
    RETURNING on_hand INTO v_new_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
    END IF;

    IF v_new_stock < 0 THEN
      NEW.negative_stock_override := true;
    END IF;
  ELSE
    UPDATE public.product_variants
    SET on_hand = on_hand + NEW.quantity_delta,
        updated_at = now()
    WHERE id = NEW.variant_id AND (on_hand + NEW.quantity_delta) >= 0
    RETURNING on_hand INTO v_new_stock;

    IF NOT FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = NEW.variant_id) THEN
        RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
      ELSE
        RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id USING ERRCODE = 'ST001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS stock_movements_after_insert ON public.stock_movements;
DROP TRIGGER IF EXISTS stock_movements_before_insert ON public.stock_movements;
CREATE TRIGGER stock_movements_before_insert
BEFORE INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_movement();


-- ─── Stock RPC functions (Ledger-backed) ──────────────────────
CREATE OR REPLACE FUNCTION decrement_stock_safe(
  p_product_id uuid,
  p_qty numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $
DECLARE
  v_variant_id uuid;
BEGIN
  SELECT id INTO v_variant_id FROM public.product_variants WHERE id = p_product_id;
  IF v_variant_id IS NULL THEN
    SELECT id INTO v_variant_id FROM public.product_variants WHERE product_id = p_product_id AND is_default = true LIMIT 1;
  END IF;

  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found for identifier %', p_product_id USING ERRCODE = 'ST002';
  END IF;

  INSERT INTO public.stock_movements (
    variant_id, quantity_delta, reason, reference_type, reference_id, actor_id
  ) VALUES (
    v_variant_id, -p_qty, 'online_sale', 'order', p_reference_id, p_actor_id
  );
END;
$;

CREATE OR REPLACE FUNCTION increment_stock(
  p_product_id uuid,
  p_qty numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $
DECLARE
  v_variant_id uuid;
BEGIN
  SELECT id INTO v_variant_id FROM public.product_variants WHERE id = p_product_id;
  IF v_variant_id IS NULL THEN
    SELECT id INTO v_variant_id FROM public.product_variants WHERE product_id = p_product_id AND is_default = true LIMIT 1;
  END IF;

  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found for identifier %', p_product_id USING ERRCODE = 'ST002';
  END IF;

  INSERT INTO public.stock_movements (
    variant_id, quantity_delta, reason, reference_type, reference_id, actor_id
  ) VALUES (
    v_variant_id, p_qty, 'customer_return', 'order', p_reference_id, p_actor_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION set_product_stock_safe(
  p_product_id uuid,
  p_target_stock numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_adjustment',
  p_note text DEFAULT NULL
)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_variant_id uuid;
  v_current_on_hand numeric;
  v_delta numeric;
  v_reason text;
  v_resulting_on_hand numeric;
BEGIN
  IF p_target_stock < 0 THEN
    RAISE EXCEPTION 'Target stock cannot be negative' USING ERRCODE = 'ST001';
  END IF;

  SELECT id, on_hand INTO v_variant_id, v_current_on_hand
  FROM public.product_variants
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_variant_id IS NULL THEN
    SELECT id, on_hand INTO v_variant_id, v_current_on_hand
    FROM public.product_variants
    WHERE product_id = p_product_id AND is_default = true
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'Variant not found for identifier %', p_product_id USING ERRCODE = 'ST002';
  END IF;

  v_delta := p_target_stock - v_current_on_hand;

  IF v_delta <> 0 THEN
    v_reason := COALESCE(p_reason, CASE WHEN v_delta > 0 THEN 'manual_adjustment' ELSE 'damage_write_off' END);
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, actor_id, note
    ) VALUES (
      v_variant_id, v_delta, v_reason, 'manual', p_actor_id, COALESCE(p_note, 'Admin stock adjustment to ' || p_target_stock)
    );
  END IF;

  SELECT on_hand INTO v_resulting_on_hand
  FROM public.product_variants
  WHERE id = v_variant_id;

  RETURN v_resulting_on_hand;
END;
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
-- SEC-003: public/anon coupon read removed (live policy "coupons_customer_read").
-- Validation is server-side only (POST /api/coupons/validate, service role);
-- admin list via GET /admin/coupons (service role). No public coupon-read view.
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
  variant_id uuid references public.product_variants(id) on delete cascade,
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
  variant_id               uuid references public.product_variants(id) on delete set null,
  product_title_snapshot   text not null,
  variant_title_snapshot   text,
  product_price_snapshot   numeric(10,2) not null,
  sku_snapshot             text,
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
create policy "Comments: own insert" on public.comments for insert with check (auth.uid() = user_id and approved = false);
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
-- SEC-005 (P2): rewritten to use public.is_admin() (recursion-safe). Live policy
-- name reconciled to audit_admin_read.
create policy "audit_admin_read" on public.audit_log for select using (
  public.is_admin()
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

-- ─── M2a: Suppliers, Goods Receipts, Valuation Projection ─────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  contact_info text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Suppliers: staff/admin read" ON public.suppliers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
CREATE POLICY "Suppliers: staff insert" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));
CREATE POLICY "Suppliers: admin write" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text UNIQUE NOT NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  posting_date      timestamptz NOT NULL DEFAULT now(),
  reference_note    text,
  note              text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  transaction_id    uuid,
  created_by        uuid REFERENCES public.users(id),
  posted_by         uuid REFERENCES public.users(id),
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_posting_date ON public.goods_receipts(posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON public.goods_receipts(status);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "GoodsReceipts: staff/admin read" ON public.goods_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
CREATE POLICY "GoodsReceipts: staff draft insert" ON public.goods_receipts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND status = 'draft');
CREATE POLICY "GoodsReceipts: staff draft update" ON public.goods_receipts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND status = 'draft')
  WITH CHECK (status = 'draft' AND posted_by IS NULL AND posted_at IS NULL AND transaction_id IS NULL);
CREATE POLICY "GoodsReceipts: staff draft delete" ON public.goods_receipts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND status = 'draft');
CREATE POLICY "GoodsReceipts: admin all" ON public.goods_receipts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.goods_receipt_costs (
  receipt_id        uuid PRIMARY KEY REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  additional_costs  numeric(10,2) CHECK (additional_costs >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReceiptCosts: admin only" ON public.goods_receipt_costs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.goods_receipt_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id     uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON public.goods_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_variant ON public.goods_receipt_lines(variant_id);

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReceiptLines: staff/admin read" ON public.goods_receipt_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
CREATE POLICY "ReceiptLines: staff draft insert" ON public.goods_receipt_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft'));
CREATE POLICY "ReceiptLines: staff draft update" ON public.goods_receipt_lines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft'))
  WITH CHECK (quantity > 0 AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft'));
CREATE POLICY "ReceiptLines: staff draft delete" ON public.goods_receipt_lines FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft'));
CREATE POLICY "ReceiptLines: admin all" ON public.goods_receipt_lines FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.goods_receipt_line_costs (
  line_id     uuid PRIMARY KEY REFERENCES public.goods_receipt_lines(id) ON DELETE CASCADE,
  unit_cost   numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_line_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ReceiptLineCosts: admin only" ON public.goods_receipt_line_costs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.stock_movement_costs (
  movement_id               uuid PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
  variant_id                uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  posting_date              timestamptz NOT NULL,
  created_at                timestamptz NOT NULL,
  quantity_delta            numeric(12,3) NOT NULL,
  unit_cost                 numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost                numeric(12,2) NOT NULL,
  running_quantity          numeric(12,3) NOT NULL,
  running_cost_basis_qty    numeric(12,3) NOT NULL,
  running_avg_cost          numeric(10,4) NOT NULL CHECK (running_avg_cost >= 0),
  has_unknown_cost_basis    boolean NOT NULL DEFAULT false,
  computed_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smc_replay_order ON public.stock_movement_costs(variant_id, posting_date ASC, created_at ASC, movement_id ASC);

ALTER TABLE public.stock_movement_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MovementCosts: admin only" ON public.stock_movement_costs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;
