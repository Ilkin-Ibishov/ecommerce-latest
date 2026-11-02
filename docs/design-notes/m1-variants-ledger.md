# M1 Design Note: Variant Layer, Stock Movement Ledger, and Staff Roles

**Status:** Proposed  
**Author:** Antigravity  
**Target Branch:** `m1/variants-ledger`  
**Reference Spec:** `docs/tasks/warehouse-m1-variants-ledger.md`  
*(Length justification: ~215 lines to provide full DDL specifications for 5 tables, triggers, and RLS policies in §3 for upfront architectural review).*  

---

## 1. Executive Summary & Core Invariants

Phase M1 replaces mutable product-level stock with an immutable, append-only stock movement ledger and introduces product variants as the sellable unit of inventory. Every product has $\ge 1$ variant (no `has_variants` flag). Quantities exist only on variants and are calculated strictly from movements. Price, SKU, and barcode reside on variants. 

Staff roles are introduced to attribute inventory actions and conceal cost/margin data from non-owner accounts without building an over-engineered permissions framework.

---

## 2. Answers to the Five Open Questions (§6)

### Q1. Enforcement Point: Database Trigger vs. App Service vs. RPC
- **Recommendation:** **Database Trigger on `stock_movements`** paired with strict DB constraints and thin RPC wrappers.
- **Reasoning:** In this stack, `@supabase/supabase-js` operates over PostgREST via HTTP. Application-side multi-statement transactions are not supported over REST; an app-side pairing (`insert movement` + `update variant`) creates split-brain vulnerability if the second HTTP request fails. Custom RPCs alone leave raw table inserts unguarded.
- **Mechanism:**
  1. An `AFTER INSERT ON stock_movements` trigger updates `product_variants.on_hand += NEW.quantity_delta` in the exact same transaction, locking the variant row (`FOR UPDATE`) and eliminating race conditions.
  2. A check constraint `CHECK (on_hand >= 0)` on `product_variants` aborts transactions that would cause negative stock.
  3. A `BEFORE UPDATE OR DELETE ON stock_movements` trigger raises an exception, ensuring the ledger is 100% append-only.
  4. Direct updates to `product_variants.on_hand` from application code are blocked by a trigger (`pg_trigger_depth() <= 1`), forcing all writes through `stock_movements`.
  5. Thin RPC wrappers (`decrementStockSafe`, `recordMovement`) in `src/lib/inventory/` provide typed ergonomics.

### Q2. Migration Strategy: ~311 Call Sites Across 46 Files
- **Recommendation:** **Three-Step Phased Migration with a Database Compatibility Layer** (never big-bang).
- **Phasing:**
  1. *Phase A (Schema & Backfill):* Apply migrations creating `product_variants`, options tables, and `stock_movements`. Backfill exactly one default variant for every existing product. Add `variant_id` (nullable) to `cart_items` and `order_items` backfilled from the default variant.
  2. *Phase B (Route & Component Migration):* Migrate core inventory mutation paths first (`src/lib/inventory/`, `routes/admin/products.ts`, `routes/orders.ts`), bringing `audit:invariants:strict` to green. Migrate cart/storefront reads to resolve variants.
  3. *Phase C (Schema Hardening):* Make `variant_id` NOT NULL on `cart_items` and `order_items`. Drop `products.stock` and deprecate `products.price`/`sku` in favor of variant values.
- **Rollback & Deployability:** Migrations are forward-only. Additive columns and tables keep `main` deployable throughout. If a route defect occurs, application code can be rolled back safely without database rollbacks.

### Q3. Order History Durability
- **Recommendation:** `order_items` must snapshot **both** a human-readable variant title/options string (`variant_title_snapshot`, e.g., `"Cotton Tee (Large / Navy)"`) and the SKU (`sku_snapshot`).
- **Reasoning:** If an option or variant is subsequently renamed or deleted, joins against `product_option_values` fail or produce historical inaccuracies. Invoices and receipts are permanent accounting records and must render immutably without joining mutable catalog tables.

### Q4. Barcode Lookup: Endpoint Shape & Uniqueness
- **Recommendation:** Barcode uniqueness belongs on `product_variants(barcode)` via a partial unique index:  
  `CREATE UNIQUE INDEX idx_variants_barcode ON public.product_variants(barcode) WHERE barcode IS NOT NULL;`
- **Endpoint:** `GET /api/inventory/scan/:barcode`
- **Payload (Single Round-Trip):**
  ```json
  {
    "variant": { "id": "uuid", "sku": "TSH-L-BLK", "barcode": "4006381333931", "price": 24.50, "on_hand": 12, "unit_of_measure": "pcs", "options": [{ "name": "Size", "value": "L" }] },
    "product": { "id": "uuid", "title": "Cotton T-Shirt", "slug": "cotton-t-shirt", "image_url": "https://..." }
  }
  ```
  Returns all data needed by both POS counter-sale and warehouse stock adjustment in one scan.

### Q5. Indexes and Query Patterns
Only 4 targeted B-tree indexes are added (avoiding premature index bloat):
1. `stock_movements(variant_id, created_at DESC)`: Per-variant audit trail / history view.
2. `stock_movements(created_at DESC)`: Daily movement timeline and store-wide audit queries.
3. `product_variants(product_id, sort_order)`: Fetching all variants for a product detail or admin edit screen.
4. `product_variants(barcode) WHERE barcode IS NOT NULL`: Unique index powering instantaneous 1-scan lookups.

---

## 3. Proposed Schema Design

```sql
-- ─── 1. Staff Roles ──────────────────────────────────────────
-- Alter existing users table check constraint:
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'staff', 'admin'));

-- ─── 2. Product Variants ──────────────────────────────────────
CREATE TABLE public.product_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku              text UNIQUE,
  barcode          text,
  price            numeric(10,2) NOT NULL CHECK (price >= 0),
  cost_price       numeric(10,2) CHECK (cost_price >= 0), -- Visible only to role = 'admin' (owner)
  on_hand          numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  unit_of_measure  text NOT NULL DEFAULT 'pcs',
  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Variants: public read" ON public.product_variants FOR SELECT USING (true);
CREATE POLICY "Variants: admin/staff write" ON public.product_variants FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- ─── 3. Option Types and Values (Normalized) ─────────────────
CREATE TABLE public.product_option_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name        text NOT NULL, -- e.g. 'Size', 'Color'
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);
ALTER TABLE public.product_option_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OptionTypes: public read" ON public.product_option_types FOR SELECT USING (true);
CREATE POLICY "OptionTypes: admin/staff write" ON public.product_option_types FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

CREATE TABLE public.product_option_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_type_id  uuid NOT NULL REFERENCES public.product_option_types(id) ON DELETE CASCADE,
  value           text NOT NULL, -- e.g. 'M', 'Red'
  sort_order      integer NOT NULL DEFAULT 0,
  UNIQUE (option_type_id, value)
);
ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OptionValues: public read" ON public.product_option_values FOR SELECT USING (true);
CREATE POLICY "OptionValues: admin/staff write" ON public.product_option_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

CREATE TABLE public.variant_option_values (
  variant_id       uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  option_value_id  uuid NOT NULL REFERENCES public.product_option_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, option_value_id)
);
ALTER TABLE public.variant_option_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "VarOptValues: public read" ON public.variant_option_values FOR SELECT USING (true);
CREATE POLICY "VarOptValues: admin/staff write" ON public.variant_option_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- ─── 4. Stock Movement Ledger ────────────────────────────────
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
  'assembly_consume', -- Reserved for M3
  'assembly_produce'  -- Reserved for M3
);

CREATE TABLE public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id     uuid, -- Nullable hook for future multi-location support
  quantity_delta  numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason          stock_movement_reason NOT NULL,
  reference_type  text CHECK (reference_type IN ('order', 'purchase_order', 'stocktake', 'manual')),
  reference_id    text,
  unit_cost       numeric(10,2) CHECK (unit_cost >= 0),
  actor_id        uuid REFERENCES public.users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Movements: staff/admin read" ON public.stock_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);
CREATE POLICY "Movements: staff/admin insert" ON public.stock_movements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
);

-- Append-only enforcement trigger:
CREATE OR REPLACE FUNCTION trg_stock_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only: updates and deletes are forbidden';
END;
$$;
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_movements_immutable();

-- Quantity pairing trigger:
CREATE OR REPLACE FUNCTION trg_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.product_variants
  SET on_hand = on_hand + NEW.quantity_delta,
      updated_at = now()
  WHERE id = NEW.variant_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_after_insert AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_movement();
```

---

## 4. Key Architectural Trade-Offs & Disagreements with Spec

1. **Disagreement on Enforcement (Trigger vs RPC vs Service Layer):**  
   The spec ponders DB vs App layer. In PostgREST/Supabase, application transactions across HTTP do not exist. We enforce pairing via an `AFTER INSERT` database trigger on `stock_movements`. This guarantees atomicity for any writer (API, migration, CLI) without duplicating transaction logic in Express.
2. **Disagreement on Outgoing Movement Cost Recording (§4):**  
   The spec asks whether outgoing movements should record consumed cost now. Proposing to record consumed cost in M1 without cost layers is an anti-pattern (it records replacement cost, distorting accounting). We restrict `unit_cost` to incoming movements in M1 and defer outgoing COGS depletion to M2 when weighted-average cost lands.
3. **Product Create vs. Update Quantity (Admin UX):**  
   - `PUT /admin/products/:id`: **Strictly rejected.** Stock cannot be passed on edit.
   - `POST /admin/products`: **Accepted as optional `initial_quantity`.** Under the hood, the backend wraps the creation in a single transaction that creates the product, default variant, and an initial `opening_balance` movement row. Staff are not forced into a jarring secondary modal just to catalog a new product.
4. **Opening Balances for Existing vs. Fresh Tenants:**  
   - For tenants with existing stock: migration generates a default variant with `on_hand = products.stock` and creates an `'opening_balance'` movement dated at product creation with `actor_id = NULL` and `note = 'Initial migration opening balance'`.
   - For the first customer (whose current stock is untracked): opening balance is 0. Accurate inventory begins with physical stocktake in M2.
5. **Staff Role Scope:**  
   Staff can view catalog data, scan barcodes, and adjust stock with a mandatory reason. Staff cannot view `cost_price`/margins (censored at API route level) and cannot modify product prices or change user roles.

---

## 5. Verification & Test Strategy

1. **Invariants Strict Compliance:** Eliminate the 6 known violations in `scripts/audit/baseline.json`. `pnpm run audit:invariants:strict` must pass with zero violations.
2. **Ledger Conformance & Property Tests:** Extend `artifacts/api-server/tests/helpers/stock-model.ts` to model the ledger. Verify that $\sum(\text{movements}) \equiv \text{on\_hand}$ across randomized concurrent sales, restocks, and cancellations.
3. **Role Gating Tests:** Unit and integration tests verifying staff cannot read cost/margin or mutate prices.
