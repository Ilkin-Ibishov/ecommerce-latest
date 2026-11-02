-- =============================================================================
-- Migration: M1 Variant Layer, Stock Movement Ledger, and Staff Roles
-- Timestamp: 20261102100000_m1_variants_ledger.sql
-- =============================================================================

-- ─── 1. Staff Roles ──────────────────────────────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'staff', 'admin'));

-- ─── 2. Product Variants ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku              text UNIQUE,
  barcode          text,
  price            numeric(10,2) NOT NULL CHECK (price >= 0),
  on_hand          numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  unit_of_measure  text NOT NULL DEFAULT 'pcs',
  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_single_default
  ON public.product_variants(product_id) WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_barcode
  ON public.product_variants(barcode) WHERE barcode IS NOT NULL;

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
CREATE OR REPLACE FUNCTION trg_guard_staff_price_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff') THEN
      RAISE EXCEPTION 'Staff are not permitted to change product prices' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_guard_price ON public.product_variants;
CREATE TRIGGER product_variants_guard_price
BEFORE UPDATE OF price ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_staff_price_update();

-- Trigger: Guard single write path for on_hand (resolving B3)
CREATE OR REPLACE FUNCTION trg_guard_variant_on_hand_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Direct update of product_variants.on_hand is forbidden. Changes must be recorded via stock_movements.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_guard_on_hand ON public.product_variants;
CREATE TRIGGER product_variants_guard_on_hand
BEFORE UPDATE OF on_hand ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_variant_on_hand_update();

-- ─── 3. Variant Costs (Admin-Only Margin Secrecy) ────────────
CREATE TABLE IF NOT EXISTS public.variant_costs (
  variant_id   uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
  cost_price   numeric(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
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
DO $$
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
$$;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id     uuid,
  quantity_delta  numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason          stock_movement_reason NOT NULL,
  reference_type  text CHECK (reference_type IN ('order', 'purchase_order', 'stocktake', 'manual')),
  reference_id    text,
  unit_cost       numeric(10,2) CHECK (unit_cost >= 0),
  actor_id        uuid REFERENCES public.users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_created
  ON public.stock_movements(variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created
  ON public.stock_movements(created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Movements: staff/admin read" ON public.stock_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);
CREATE POLICY "Movements: staff/admin insert" ON public.stock_movements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- Trigger: stock_movements is append-only
CREATE OR REPLACE FUNCTION trg_stock_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only: updates and deletes are forbidden' USING ERRCODE = '2BP01';
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_no_update_delete ON public.stock_movements;
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_movements_immutable();

-- Trigger: Atomic quantity pairing on stock_movements insert
-- NOTE: Uses distinct custom SQLSTATE error codes in unassigned class 'ST':
--   ST001: Insufficient stock for variant
--   ST002: Variant not found
CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric(12,3);
BEGIN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_after_insert ON public.stock_movements;
CREATE TRIGGER stock_movements_after_insert AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_movement();

-- ─── 6. Backfill Default Variants & Opening Balances ─────────
DO $$
DECLARE
  r RECORD;
  v_variant_id uuid;
BEGIN
  FOR r IN SELECT id, sku, price, stock FROM public.products LOOP
    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = r.id) THEN
      v_variant_id := gen_random_uuid();
      INSERT INTO public.product_variants (
        id, product_id, sku, price, on_hand, unit_of_measure, is_default, sort_order
      ) VALUES (
        v_variant_id, r.id, r.sku, r.price, 0, 'pcs', true, 0
      );

      INSERT INTO public.variant_costs (variant_id, cost_price)
      VALUES (v_variant_id, 0);

      IF r.stock > 0 THEN
        INSERT INTO public.stock_movements (
          variant_id, quantity_delta, reason, reference_type, actor_id, note
        ) VALUES (
          v_variant_id, r.stock, 'opening_balance', 'manual', NULL, 'Initial migration opening balance'
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ─── 7. Add variant_id to cart_items & order_items ───────────
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE;

UPDATE public.cart_items ci
SET variant_id = pv.id
FROM public.product_variants pv
WHERE ci.variant_id IS NULL AND pv.product_id = ci.product_id AND pv.is_default = true;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS variant_title_snapshot text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS sku_snapshot text;

UPDATE public.order_items oi
SET variant_id = pv.id,
    variant_title_snapshot = COALESCE(oi.variant_title_snapshot, oi.product_title_snapshot),
    sku_snapshot = COALESCE(oi.sku_snapshot, pv.sku)
FROM public.product_variants pv
WHERE oi.variant_id IS NULL AND pv.product_id = oi.product_id AND pv.is_default = true;

-- ─── 8. Ledger-backed RPC functions ───────────────────────────
CREATE OR REPLACE FUNCTION decrement_stock_safe(
  p_product_id uuid,
  p_qty numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
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
$$;

CREATE OR REPLACE FUNCTION increment_stock(
  p_product_id uuid,
  p_qty numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
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
