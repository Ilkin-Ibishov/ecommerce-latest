# M1 Design Note: Variant Layer, Stock Movement Ledger, and Staff Roles

**Status:** Revised (Resolving Architecture Review findings B1–B3, M1, and Minors)  
**Author:** Antigravity  
**Target Branch:** `m1/variants-ledger`  
**Reference Spec:** `docs/tasks/warehouse-m1-variants-ledger.md`  
*(Length justification: ~285 lines to provide complete DDL specifications for tables, triggers, and RLS policies in §3, resolving all architectural review blockers upfront).*  

---

## 1. Executive Summary & Core Invariants

Phase M1 replaces mutable product-level stock with an immutable, append-only stock movement ledger and introduces product variants as the sellable unit of inventory. Every product has $\ge 1$ variant (no `has_variants` flag). Quantities exist only on variants and are calculated strictly from movements. Price, SKU, and barcode reside on variants. 

Cost and margin data are strictly isolated into a dedicated `variant_costs` table governed by admin-only Row Level Security (RLS), preventing margin leakage across direct PostgREST client reads. Staff roles are introduced to attribute inventory actions and restrict price alterations without building an over-engineered permissions framework.

---

## 2. Answers to the Five Open Questions (§6)

### Q1. Enforcement Point: Database Trigger vs. App Service vs. RPC
- **Recommendation:** **Database Trigger on `stock_movements`** paired with strict DB constraints, single-write-path trigger guards, and thin RPC wrappers.
- **Reasoning:** In this stack, `@supabase/supabase-js` operates over PostgREST via HTTP. Application-side multi-statement transactions are not supported over REST; an app-side pairing (`insert movement` + `update variant`) creates split-brain vulnerability if the second HTTP request fails. Custom RPCs alone leave raw table inserts unguarded.
- **Mechanism:**
  1. An `AFTER INSERT ON stock_movements` trigger updates `product_variants.on_hand += NEW.quantity_delta` atomically within the same transaction. In PostgreSQL, `UPDATE ... SET on_hand = on_hand + delta` takes an exclusive row lock; under `READ COMMITTED`, concurrent transactions queue and re-read the updated row before applying their delta. This guarantees race-free concurrency without requiring an explicit `FOR UPDATE` query (resolving M1).
  2. A domain-specific check inside the trigger prevents negative stock and raises `RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id USING ERRCODE = 'P0001'`. The RPC wrapper catches SQLSTATE `P0001` and maps it to HTTP `409 Out of stock` / `400 Insufficient stock`, maintaining API contracts and test suite compatibility (resolving B2). A `CHECK (on_hand >= 0)` constraint on `product_variants` remains as an unreachable structural backstop.
  3. A `BEFORE UPDATE OR DELETE ON stock_movements` trigger raises an exception, ensuring the ledger is 100% append-only.
  4. Direct updates to `product_variants.on_hand` are blocked at the database level by a `BEFORE UPDATE OF on_hand` trigger checking `pg_trigger_depth() <= 1` (`ERRCODE = '55000'`). Legitimate updates originating from `stock_movements` execute at `pg_trigger_depth() = 2` and proceed, structurally enforcing that the movement ledger is the single write path (resolving B3).
  5. Thin RPC wrappers (`decrementStockSafe`, `recordMovement`) in `src/lib/rpc.ts` provide typed ergonomics.

### Q2. Migration Strategy: ~311 Call Sites Across 46 Files
- **Recommendation:** **Three-Step Phased Migration with a Database Compatibility Layer** (never big-bang).
- **Phasing:**
  1. *Phase A (Schema & Backfill):* Apply migrations creating `product_variants`, `variant_costs`, options tables, and `stock_movements`. Backfill exactly one default variant for every existing product. Add `variant_id` (nullable) to `cart_items` and `order_items` backfilled from the default variant.
  2. *Phase B (Route & Component Migration):* Migrate core inventory mutation paths first (`src/lib/rpc.ts`, `routes/admin/products.ts`, `routes/orders.ts`), bringing `audit:invariants:strict` to green. Migrate cart/storefront reads to resolve variants.
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
Only 5 targeted B-tree indexes are added (avoiding premature index bloat):
1. `stock_movements(variant_id, created_at DESC)`: Per-variant audit trail / history view.
2. `stock_movements(created_at DESC)`: Daily movement timeline and store-wide audit queries.
3. `product_variants(product_id, sort_order)`: Fetching all variants for a product detail or admin edit screen.
4. `product_variants(barcode) WHERE barcode IS NOT NULL`: Unique index powering instantaneous 1-scan lookups.
5. `product_variants(product_id) WHERE is_default`: Unique index preventing multiple default variants per product (resolving Minor 2).

---

## 3. Proposed Schema Design

```sql
-- ─── 1. Staff Roles ──────────────────────────────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'staff', 'admin'));

-- ─── 2. Product Variants ──────────────────────────────────────
CREATE TABLE public.product_variants (
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
CREATE UNIQUE INDEX idx_product_variants_single_default
  ON public.product_variants(product_id) WHERE is_default = true;

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
CREATE TRIGGER product_variants_guard_on_hand
BEFORE UPDATE OF on_hand ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_variant_on_hand_update();

-- ─── 3. Variant Costs (Admin-Only Margin Secrecy) ────────────
-- Cost separated to prevent disclosure via public PostgREST reads (resolving B1)
CREATE TABLE public.variant_costs (
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
CREATE TABLE public.product_option_types (
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

CREATE TABLE public.product_option_values (
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

-- ─── 5. Stock Movement Ledger ────────────────────────────────
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
  reference_id    text, -- Polymorphic reference without FK (resolving Minor 3)
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
  RAISE EXCEPTION 'stock_movements is append-only: updates and deletes are forbidden' USING ERRCODE = '2BP01';
END;
$$;
CREATE TRIGGER stock_movements_no_update_delete BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_movements_immutable();

-- Quantity pairing trigger with domain error on insufficient stock (resolving B2, M1):
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
      RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'P0002';
    ELSE
      RAISE EXCEPTION 'Insufficient stock for variant %', NEW.variant_id USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_after_insert AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_movement();
```

---

## 4. Key Architectural Trade-Offs & Disagreements with Spec

1. **Resolution of B1: Structuring `variant_costs` as a Separate Table (Chosen over Views):**  
   - *Why Option 1 was chosen:* The admin client talks directly to PostgREST via `@supabase/supabase-js` (`createClient()`). Row Level Security controls row visibility, not column projections. If `cost_price` remained on `product_variants` under a public read policy (`USING (true)`), any anonymous or staff visitor querying `/product_variants?select=*` would inspect wholesale costs and margins.
   - *Why not Option 2 (Views):* Exposing views for public reads breaks PostgREST write ergonomics, prevents standard nested foreign key embeddings (e.g. `product_variants?select=*,product_images(*)`), and complicates Orval/Zod codegen schemas.
   - *M2 readiness:* Moving cost to `variant_costs` provides a dedicated isolation boundary for M2's inventory costing model (e.g., adding `moving_average_cost`, `last_received_cost`) without touching the lightweight catalog variant table.
2. **Resolution of B2 & M1: Concurrency Semantics & Domain Error Handling:**  
   - *Atomic update concurrency (M1):* The previous draft erroneously referenced `FOR UPDATE`. In PostgreSQL, an atomic `UPDATE ... SET on_hand = on_hand + delta WHERE ...` acquires an exclusive row-level lock on the variant row. Under `READ COMMITTED` isolation, concurrent updates queue; once unlocked, the engine re-evaluates the expression and predicate against the newly committed row state. This ensures serializable increments/decrements in-place without explicit read-locks or read-modify-write races.
   - *Catchable domain error (B2):* Relying on `CHECK (on_hand >= 0)` produces generic SQLSTATE `23514` (`check_violation`), causing the API to respond with 500. The trigger now verifies `(on_hand + NEW.quantity_delta) >= 0` during the atomic update and explicitly raises SQLSTATE `P0001` with message `'Insufficient stock for variant %'`. The RPC wrapper catches `P0001` and returns the expected `409 Out of stock` / `400 Insufficient stock` response, preserving Invariant 7 and existing test assertions.
3. **Resolution of B3: Single-Write-Path Enforcement via `pg_trigger_depth()`:**  
   To guarantee the invariant that stock can *only* change via `stock_movements`, a trigger on `product_variants` aborts any direct `on_hand` mutation where `pg_trigger_depth() <= 1` (`ERRCODE = '55000'`). Internal calls from `stock_movements_after_insert` run at `pg_trigger_depth() = 2` and succeed.
4. **Resolution of Minor 1 & Minor 3 (Staff Price Protection & Polymorphic References):**  
   - *Staff price modification (Minor 1):* Enforced by `trg_guard_staff_price_update` raising `ERRCODE = '42501'` if a staff user attempts to alter `price`, keeping RLS and role rules in complete alignment.
   - *Polymorphic `reference_id` (Minor 3):* `reference_id text` is deliberately unenforced by foreign keys because it points polymorphically to `orders.id`, or future `purchase_orders.id` / `stocktakes.id`. This avoids multiple sparse nullable FK columns.
5. **Disagreement on Outgoing Movement Cost Recording (§4):**  
   We restrict `unit_cost` to incoming movements in M1 and defer outgoing COGS depletion to M2 when weighted-average cost lands. Recording consumed cost before cost layers exist records replacement cost, silently distorting margin.
6. **Product Create vs. Update Quantity (Admin UX):**  
   - `PUT /admin/products/:id`: Strictly rejected. Stock cannot be passed on edit.
   - `POST /admin/products`: Accepted as optional `initial_quantity`. The backend creates the product, default variant, and initial `opening_balance` movement within one transaction.
7. **Opening Balances for Existing vs. Fresh Tenants:**  
   - Populated tenants: default variant created with `on_hand = products.stock` and an initial `'opening_balance'` movement with `actor_id = NULL` and `note = 'Initial migration opening balance'`.
   - Fresh tenants: opening balance is 0.

---

## 5. Verification & Test Strategy

1. **Invariants Strict Compliance:** Eliminate the 6 known violations in `scripts/audit/baseline.json`. `pnpm run audit:invariants:strict` must pass with zero violations.
2. **Single-Write-Path Tests:** Assert that direct SQL updates to `product_variants.on_hand` throw SQLSTATE `55000`.
3. **Insufficient Stock & Concurrency Property Tests:** Extend `artifacts/api-server/tests/helpers/stock-model.ts` to model the ledger. Verify that concurrent decrements beyond available stock fail with SQLSTATE `P0001` and map to HTTP 409 / 400. Assert $\sum(\text{movements}) \equiv \text{on\_hand}$ across randomized concurrent operations.
4. **Role & Cost RLS Security Tests:** Verify that non-admin accounts (anonymous storefront users, authenticated customers, and staff) receive 0 rows when selecting `variant_costs` via PostgREST. Verify that staff attempting to alter `price` fail with SQLSTATE `42501`.
