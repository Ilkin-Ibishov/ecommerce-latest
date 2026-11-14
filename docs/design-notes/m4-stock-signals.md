# M4 Design Note: Stock Signals (Low Stock, Reorder Suggestions, Dead Stock)

> **Phase Branch:** `m4/stock-signals-core`  
> **Spec:** `docs/tasks/warehouse-m4-stock-signals.md` (§6.4, §9, §12)  
> **Audits:** `docs/audits/m4-architect-audit.md` (Split 2026-11-14)  
> **Domain Rules:** `AGENTS.md`, `.agents/rules/inventory.md`, `.agents/rules/migrations.md`, `.agents/rules/frontend.md`  
> **Status:** Revision 2 — 2026-11-14. Revised following architect audit rejection of branch `m4/stock-signals`. Replaces low-stock digest architecture (§5), extends non-tracked variant transition rules (§4), updates migration sequencing and availability NULL handling (§4.4, §8).

---

## Revision 2 — 2026-11-14

This revision directly addresses the audit findings from `docs/audits/m4-architect-audit.md` and the instructions in `prompts/m4-design-revision.md`.

| Audit Finding | Subject Area | What Changed in this Note |
|---|---|---|
| **B2** | Column order in `product_variant_availability` | `track_stock` is placed at the **end** of the view's select list (column 9). No `DROP VIEW` is attempted because `product_variant_public_availability` depends on it (§4.4, §8). |
| **B3** | Collision with chore `counter_sale_payments` | `20261113220010` is removed from defining `post_counter_sale`. A new migration timestamped after `20261113230400` defines `post_counter_sale` once, carrying both the `counter_sale_payments` insert and the `track_stock` filter, satisfying both `post-counter-sale-writes-payments` and `no-non-tracked-variant-movements` (§4.5, §8). |
| **M1** | Divergent TypeScript fallback libs | Closed by branch split. All signal calculations remain exclusively in database RPCs. An RPC failure returns HTTP 500. No fallback library or try/catch bypass exists (§6.1). |
| **M2** | Low-stock digest never evaluated & unread | Completely replaced §5. Evaluation triggers inside API request paths after stock-lowering events (`post_counter_sale`, `decrement_order_stock`). Analyzed delivery mechanisms: owner notification recipient routing via WhatsApp vs the zero-footprint "dashboard is the signal" alternative. Guaranteed atomic DB transactions to eliminate suppression/send divergence (§5). |
| **M3** | Non-tracked variant switches and intersections | Extended §4. Database trigger `trg_guard_track_stock_change` blocks `true → false` while `on_hand <> 0`, active stocktakes exist, or reservations are active. Allowed compensating reversals on void via `correlation_id` matching, proving `verify_stock_integrity` holds. Specified `false → true` ledger entry, bundle availability over tracked components, and stocktake count sheet exclusion (§4.2, §4.3). |
| **m1** | Non-tracked availability representation | Replaced literal `999999` with `NULL` for unlimited availability. Conducted an exhaustive audit of every storefront, admin, API, and SQL reader of `available_quantity` (§4.4). |

---

## 1. The Shape in One Paragraph

Stock signals in Phase M4 answer the owner's three standing commercial questions—*What am I about to run out of?*, *What is my money sitting in that nobody is buying?*, and *What should I order and how much?*—strictly as **derived read-time calculations** from the append-only movement ledger and active reservations, without storing any computed signal column on `product_variants`. The phase begins by closing the latent `track_stock` defect in the database apply trigger (`trg_apply_stock_movement`) and guarding tracking transitions in both directions: non-tracked variants cannot record new ledger movements and report `NULL` (unlimited) availability, while historical sales made while tracked remain fully voidable through compensating reversals that preserve `verify_stock_integrity`. Low stock evaluates `available` stock against resolved thresholds in the API request path following sales, dispatching a consolidated WhatsApp digest to the owner (or relying entirely on the admin dashboard signal if external alerts are deferred) with database-enforced suppression to prevent noise. Dead stock ("not selling") identifies variants with on-hand units and net zero sales over a configurable window (default 90 days), calculating capital tied up from `variant_costs.cost_price` while strictly stripping cost and value metrics for staff roles in the API. Reorder suggestions calculate trailing sales velocity from net outbound sale ledger movements, displaying honest formula evidence (velocity, days of cover, sales count) and rendering an explicit "Insufficient data" badge when sales data is below threshold.

---

## 2. Answers to Spec §13 (Open Questions with Concrete Codebase Evidence)

### Q1. Is there an "on order" quantity at all?
- **Codebase Evidence:**
  - `goods_receipts` table (`supabase/migrations/20261104100000_m2a_schema_tables.sql:57`) has `status CHECK (status IN ('draft', 'posted', 'reversed'))`. A `draft` receipt is an intake document created when counting boxes physically arriving at the store door; it does not represent an open purchase order placed with a vendor.
  - In `prompts/m2a-design-revise.md`: `"- 'reference_type = 'purchase_order'' for a goods-receipt movement. There are no purchase orders in the product..."`.
  - While `reference_type` in `stock_movements` permits `'purchase_order'`, design note `docs/design-notes/m1-variants-ledger.md:20` explicitly states: `reference_id text is deliberately unenforced by foreign keys because it points polymorphically to orders.id, or future purchase_orders.id`. No `purchase_orders` table has ever been created.
  - Spec §3 and §17 state: *"There is no buyer, no procurement process and no supplier portal — 'ordering' means the owner messages a supplier"* and *"Not in M4: Purchase-order generation, supplier emails, or any outbound ordering"*.
- **Decision:** No expected-but-not-received "on order" state exists anywhere in the schema. In accordance with §13 Q1 (*"drop the term from the formula and say so on screen, or justify adding the state — do not invent a column quietly"*), we **drop `on_order` from the suggested quantity formula** (treating `on_order = 0`) and explicitly display `on_order: 0 (not tracked)` on the reorder screen next to the calculation breakdown. We do not invent an unbacked column.

### Q2. Do suppliers carry a lead time?
- **Codebase Evidence:**
  - `suppliers` table (`supabase/migrations/20261104100000_m2a_schema_tables.sql:17-25`) contains only `id`, `name`, `contact_info`, `notes`, `is_active`, `created_at`, `updated_at`.
  - Grepping the entire repository for `lead_time` returns 0 hits across all migrations, routes, and components.
  - The formula in §8.2 uses `target_days` (default 60 days) to establish the stock cover horizon and does not parameterize delivery lead time.
- **Decision:** Suppliers do not carry a lead time. In accordance with §13 Q2, we will **not add a lead-time column** to `suppliers` or `product_variants`. The reorder screen groups suggestions by supplier (displaying supplier name and contact information for phone/WhatsApp messaging) without promising a delivery date.

### Q3. Where do the settings live?
- **Codebase Evidence:**
  - `store_settings` table (`supabase/migrations/20260606110418_create_store_settings.sql`) is a key-value store (`key text PRIMARY KEY`, `value text NOT NULL`, `description text`, `updated_at timestamptz`).
  - Row `low_stock_threshold` was seeded with `'10'` in that migration and is currently exposed via admin settings.
  - Creating a separate table (e.g. `inventory_settings`) would bifurcate settings storage, require migrating `low_stock_threshold`, and complicate tenant configuration.
- **Decision:** Operational parameters will join `store_settings` as new key-value pairs seeded via migration with `ON CONFLICT (key) DO NOTHING`:
  - `dead_stock_days`: default `'90'` (options 30, 60, 90, 180)
  - `reorder_target_days`: default `'60'`
  - `reorder_velocity_window_days`: default `'28'`
  - `reorder_min_sales`: default `'3'`
  - `owner_notification_phone`: default `''` (for WhatsApp alert routing, if configured)
  A centralized server-side helper reads `store_settings` with typed parsing and robust numeric fallbacks, ensuring existing code and routes continue working without schema divergence.

### Q4. Database or application?
- **Codebase Evidence:**
  - Availability is calculated in the database via `product_variant_availability` (`supabase/migrations/20261104184000_m2c_availability_view.sql`).
  - Multi-table reporting with cost/revenue calculations uses PostgreSQL security-definer RPCs, notably `get_margin_report` (`supabase/migrations/20261111120800_margin_report_live_schema.sql`).
  - Express routes act as authenticated gatekeepers (e.g. `artifacts/api-server/src/routes/admin/margins.ts`), enforcing RBAC and invoking RPCs via `service_role`.
- **Decision:** Consistent with this architecture:
  - **Database RPCs:** Heavy ledger joins, aggregations, and cost lookups are implemented as database functions (`get_low_stock_signals`, `get_dead_stock_signals`, `get_reorder_suggestions`). Direct client access is revoked (`REVOKE ... FROM public, anon, authenticated`) and granted strictly to `service_role`.
  - **Application API Layer:** Express endpoints (`/admin/inventory/signals/...`) authenticate caller sessions. For dead stock, Express verifies `req.userRole`: if `admin`, cost and capital tied up are returned; if `staff`, cost and valuation fields are stripped from all line items and totals before JSON serialization.
  - **Client Data Flow:** Admin frontend pages (`InventoryPage.tsx`, `ReorderPage.tsx`) fetch signals through Express endpoints via `adminFetch()` (which forwards admin credentials and role headers), never through direct PostgREST calls on cost tables.

### Q5. Does any variant have `track_stock = false` today?
- **Codebase & Test Project Evidence (2026-11-14 verification):**
  - Exactly one variant on the test project (`jcvsnoiacrknzejouxah`) has `track_stock = false`.
  - That variant has **zero stock movements** and `on_hand = 0`.
- **Decision & Migration Backfill Guarantee:**
  - Because no movements exist for non-tracked variants, no historical movement backfill or repair is required.
  - The migration asserts this condition via a guard block:
    ```sql
    DO $$
    DECLARE
      v_invalid_movements integer;
    BEGIN
      SELECT count(*) INTO v_invalid_movements
      FROM public.stock_movements sm
      JOIN public.product_variants pv ON pv.id = sm.variant_id
      WHERE pv.track_stock = false;

      IF v_invalid_movements > 0 THEN
        RAISE EXCEPTION 'Found % existing movements for non-tracked variants', v_invalid_movements;
      END IF;
    END $$;
    ```
  - Going forward, non-tracked variants report `NULL` availability and bypass ledger inserts during checkout and sales.

### Q6. Units of measure and `ceil` on suggested quantity
- **Codebase Evidence:**
  - `product_variants.unit_of_measure` (`20261102100000_m1_variants_ledger.sql`) defaults to `'pcs'`.
  - Domain rule `.agents/rules/inventory.md:45-48` notes: *"Quantity columns are numeric with scale, not integers — a later customer will sell by weight or length. The admin UI does not expose fractional entry until a customer needs it."*
- **Decision:**
  - For discrete units (`pcs`, `box`, `pair`, `set`), whole units must be ordered from suppliers. `ceil(target_days * velocity - available)` guarantees that the target days of cover is fully satisfied without rounding down into a stockout.
  - For continuous units (`kg`, `m`, `l`), `ceil` rounds up to the nearest integer unit (e.g. 14 m or 15 kg). In small-shop retail ordering (spec §3), suppliers package materials in discrete rolls, bags, or whole units. Rounding down (`floor`) would violate the target cover horizon. Therefore, `ceil` is mathematically sound and operationally standard for all units of measure in this phase.

---

## 3. Ordinary Flow and Intersections (§12)

Every rule introduced in Phase M4 is detailed below with its ordinary-flow behavior and its exact intersections with earlier architectural decisions.

| # | This Phase's Rule | Intersects | Ordinary-Flow Behaviour & Earlier Decisions Met |
|---|---|---|---|
| 1 | Signals read `available` | M2c reservations (`m2c-reservations.md`) | In ordinary flow, a customer deposit creates an active reservation in `public.reservations`. Physical `on_hand` remains unchanged, but `available` (`on_hand - reserved`) decreases. Low stock triggers when `available <= threshold`, correctly alerting the owner before physical stock is fully depleted. Meets M2c rule: reservations reduce available, not on hand. |
| 2 | Velocity from movements | M3a void (`m3-counter-sale.md`) | In ordinary flow, a counter sale writes a movement (`quantity_delta = -N`, `reason = 'counter_sale'`). When voided via `void_counter_sale`, a compensating movement is inserted at the original `posting_date` (`quantity_delta = +N`). The velocity query computes net units sold as `-SUM(quantity_delta)` for `reason IN ('online_sale', 'counter_sale')`. The compensating movement cancels the voided sale algebraically without special casing. |
| 3 | Velocity from movements | M3a `needs_owner` (`m3-counter-sale.md`) | In ordinary flow, a counter sale flagged as `needs_owner` (due to till stock deficit) represents goods handed to the customer. However, `post_counter_sale` holds movement insertion in an exception block until the owner resolves it via `post_pending_counter_sale`. To ensure velocity honestly reflects physical demand before the owner clicks resolve, velocity queries both posted ledger sale movements AND lines from pending `counter_sales WHERE status = 'needs_owner'`. Once posted, the sale enters `stock_movements` and drops from the pending set, preventing double counting. If voided, it leaves both sets. |
| 4 | Velocity excludes corrections | M2b stocktake (`m2b-stocktake.md`) | In ordinary flow, stocktake reconciliation writes `stocktake_correction` movements (`quantity_delta < 0` for shrinkage). Shrinkage is loss, not sales demand. Velocity strictly filters `reason IN ('online_sale', 'counter_sale')`, excluding stocktake corrections, manual adjustments, damage write-offs, and receipts. |
| 5 | Dead-stock value | M2a cost RLS (`m2a-receiving-cost.md`) | In ordinary flow, dead stock calculates capital tied up as `on_hand * COALESCE(vc.cost_price, vc.opening_cost, 0)` using `variant_costs` (`cost_price` from M1 / M2a). In accordance with M2a RLS boundary, cost data is restricted to `admin`. The database RPC is granted only to `service_role`. Express inspects the session user role: for `admin`, value columns are returned; for `staff`, `unit_cost` and `total_capital` are stripped before response transmission. |
| 6 | Dead-stock "days since last sale" & net sales | M2b opening count & M3a void | In ordinary flow, newly onboarded items entered via opening count or goods receipt have zero sales. A variant is only evaluated for dead stock if `days_since_first_received >= N` (window days). Furthermore, dead stock evaluates **net units sold** over the trailing window: a variant is dead if `net_sales <= 0`. If a sale was entered and immediately voided (net sales = 0), the variant remains dead (avoiding the voided sale blindspot). `days_since_last_sale` uses the timestamp of the latest net-positive sale transaction. |
| 7 | Low stock on components | M3a minimal bundle (`inventory.md:51`) | In ordinary flow, bundles are virtual sets with zero physical stock of their own. Stock signals run exclusively on `product_variants`. Components trigger low-stock alerts individually. The bundle’s availability is `MIN(available / qty)` evaluated strictly over its **tracked** components; non-tracked components (e.g. gift wrap) are ignored. |
| 8 | `track_stock` rejection in apply trigger | M1 ledger immutability (`inventory.md:17`) | In ordinary flow, non-tracked variants (services, custom gift wrapping) do not maintain inventory. `trg_apply_stock_movement` evaluates `track_stock` BEFORE insert and raises `ST030` if a new movement insert is attempted. Ledger immutability is preserved: existing movements are untouched. Counter sale, online checkout, and reservation fulfillment bypass movement creation for non-tracked lines. |
| 9 | Compensating reversal on void for non-tracked variant | M3a void & M1 ledger integrity | If a tracked variant was sold and then switched to `track_stock = false`, `void_counter_sale` still must succeed. `trg_apply_stock_movement` permits the compensating movement when `correlation_id` matches an existing movement for that variant. Cumulative ledger sum matches `on_hand`, and `verify_stock_integrity()` passes without divergence. |
| 10 | Guard on switching `track_stock` | M1 ledger & M2b stocktake & M2c reservations | A variant cannot transition `true → false` if `on_hand <> 0`, if it is part of an in-progress stocktake, or if active reservations exist. Enforced via database trigger `trg_guard_track_stock_change`. |
| 11 | Reorder suggestions with negative availability | M2c reservations & M3a till overrides | If a variant is in deficit (`available < 0`), `days_of_cover` is clamped to `0`. In `suggested_qty = ceil(target_days * velocity - available)`, subtracting negative available correctly adds the deficit to the order quantity, ensuring reorder covers both outstanding commitments and the target horizon. |
| 12 | Digest suppression vs stock recovery | Spec §6.4 alert discipline | When a variant drops below threshold, a suppression event is stored in `low_stock_notification_events`. If inventory is restocked such that `available > threshold`, the suppression row is deleted. Recovery itself sends no notification. When stock subsequently drops below threshold again, a new alert is generated. |

---

## 4. Defect Fix 1: `track_stock` Enforcement & Transitions (Audits M3, B2, m1)

### 4.1 Root Cause in Current Codebase
In `20261103210000_m1_schema_additions.sql`, `product_variants.track_stock` was defined as `boolean NOT NULL DEFAULT true`. However:
1. `trg_apply_stock_movement()` (`20261104190000_m2c_trigger_bypass_reasons.sql`) never checks `track_stock`. Any insert to `stock_movements` modifies `product_variants.on_hand` regardless of whether `track_stock` is false.
2. `post_counter_sale()` (`20261113230400_post_counter_sale_payments.sql:78-83`) unconditionally inserts movements for all `counter_sale_lines`.
3. `decrement_order_stock()` (`20261111110100_m2c_sales_recompute_cost.sql:79-92`) unconditionally checks stock availability and inserts movements for all order lines.
4. `fulfil_reservation()` (`20261111110100_m2c_sales_recompute_cost.sql:154`) unconditionally inserts `counter_sale` movements for reserved variants.
5. Nothing in the database prevents switching `track_stock` from `true` to `false` when physical stock, active stocktakes, or active reservations exist.

### 4.2 Two-Way Tracking Transition Rules (Audit M3)

#### Direction 1: `true → false` (Disabling Stock Tracking)
- **Preconditions Required (Must all be true first):**
  1. `on_hand = 0`: Physical stock must be zero. If a merchant has physical stock on hand, they must sell it down or write it off via an adjustment/stocktake before disabling tracking. Allowing a switch with non-zero stock freezes positive or negative units on `product_variants` that the ledger can never clear.
  2. **No open stocktakes**: The variant must not be present in `stocktake_lines` of any stocktake where `status IN ('draft', 'in_progress')`. If it were present, posting the stocktake later would attempt to insert a `stocktake_correction` movement, raising `ST030` and failing the entire stocktake.
  3. **No active reservations**: The variant must not have any rows in `public.reservations` with `status = 'active'`. Fulfilling or cancelling a reserved non-tracked variant would violate reservation invariants.
- **Enforcement Location:**
  Enforced **strictly in the database** via a `BEFORE UPDATE OF track_stock` trigger on `public.product_variants`:
  ```sql
  CREATE OR REPLACE FUNCTION public.trg_guard_track_stock_change()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
  BEGIN
    -- true -> false guards
    IF OLD.track_stock = true AND NEW.track_stock = false THEN
      IF OLD.on_hand <> 0 THEN
        RAISE EXCEPTION 'Cannot disable stock tracking for variant % with non-zero on_hand (%)',
          OLD.id, OLD.on_hand USING ERRCODE = 'ST031';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.stocktake_lines sl
        JOIN public.stocktakes st ON st.id = sl.stocktake_id
        WHERE sl.variant_id = OLD.id AND st.status IN ('draft', 'in_progress')
      ) THEN
        RAISE EXCEPTION 'Cannot disable stock tracking for variant % on active stocktake',
          OLD.id USING ERRCODE = 'ST032';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.reservations r
        WHERE r.variant_id = OLD.id AND r.status = 'active'
          AND (r.expires_at IS NULL OR r.expires_at > now())
      ) THEN
        RAISE EXCEPTION 'Cannot disable stock tracking for variant % with active reservations',
          OLD.id USING ERRCODE = 'ST033';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $$;

  CREATE TRIGGER trg_guard_variant_track_stock
    BEFORE UPDATE OF track_stock ON public.product_variants
    FOR EACH ROW EXECUTE FUNCTION public.trg_guard_track_stock_change();
  ```

#### After the Switch: Counter Sale Void Reversals
- **The Dilemma:**
  A tracked variant was sold (`sm` with `quantity_delta = -N`, `reason = 'counter_sale'`). Stock dropped to 0. The owner then switched `track_stock = false` (permitted because `on_hand = 0`). The customer returns the item and the owner calls `void_counter_sale`.
  - Rejecting the reversal makes the sale un-voidable, breaking till reconciliation and revenue accuracy.
  - Letting the reversal through inserts a movement for a non-tracked variant.
- **Decision:** **Let the reversal through.**
  A void is a compensating transaction reversing a sale that occurred when stock was physically tracked. The till must not be held hostage.
- **Trigger Exception via `correlation_id`:**
  `void_counter_sale` (`supabase/migrations/20261111120600_m3_void_counter_sale.sql:40-45`) sets `correlation_id = sm.id` (pointing to the original sale movement).
  We update `trg_apply_stock_movement` to permit movements for `track_stock = false` variants **only** when `correlation_id` matches an existing movement for that variant:
  ```sql
  IF NOT v_track_stock THEN
    -- Allow compensating reversals of historical movements
    IF NEW.correlation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE id = NEW.correlation_id AND variant_id = NEW.variant_id
    ) THEN
      NULL; -- Permitted: reversing an earlier tracked movement
    ELSE
      RAISE EXCEPTION 'Stock movements cannot be created for non-tracked variant %', NEW.variant_id
        USING ERRCODE = 'ST030';
    END IF;
  END IF;
  ```
- **Proof that `verify_stock_integrity` Still Holds:**
  1. *Check 1 (`ledger_vs_on_hand`):* The void inserts `quantity_delta = +N`. `trg_apply_stock_movement` applies the delta: `pv.on_hand` becomes `0 + N = N`. In `stock_movements`, the cumulative sum is `(-N) + (+N) = 0` (or `initial + (-N) + (+N) = initial`). Both `pv.on_hand` and `SUM(sm.quantity_delta)` evaluate to `N`. `diff = 0`. Check 1 passes.
  2. *Check 2 (`projection_vs_ledger`):* `void_counter_sale` calls `recompute_variant_cost(variant_id, posting_date)`. The replay re-values the projection. `running_quantity` matches the cumulative ledger sum. Check 2 passes.
  3. *Check 3 (`unvalued_movement`):* The reversal movement receives a valuation record in `stock_movement_costs`. Check 3 passes.
  4. *Check 4 (`cache_vs_projection`):* Cache matches the latest projection row. Check 4 passes.
  5. *Availability View:* Because `track_stock = false`, `product_variant_availability` reports `available_quantity = NULL` (unlimited). The customer-facing till and storefront are unaffected by the legacy `on_hand = N`.

#### Direction 2: `false → true` (Enabling Stock Tracking)
- **`on_hand` Starting Value:**
  Starts from whatever value exists in `product_variants.on_hand` (typically `0`).
- **How Real Quantity Enters:**
  Direct SQL updates to `product_variants.on_hand` are strictly blocked by M1 trigger `trg_guard_variant_on_hand_update`. Physical stock can enter **only through ledger movements** via standard warehouse intake:
  1. *Goods Receipt:* Posting a receipt via `post_goods_receipt()` inserts `goods_receipt` movements (`quantity_delta = +N`) and sets cost.
  2. *Opening Stocktake / Stocktake:* Counting the variant on a stocktake sheet and posting via `post_stocktake()` inserts `stocktake_correction` or `opening_balance` movements.

#### Intersections Addressed by Name:
- **M1 "stock changes only through the ledger":** No column updates to `on_hand` bypass the ledger. Void reversals and new intake write immutable ledger rows.
- **M2b stocktake posting:** Non-tracked variants are excluded from stocktakes. Switching `true → false` is blocked if a stocktake is in progress.
- **M2c reservation fulfilment:** Non-tracked variants cannot have reservations. `fulfil_reservation` skips movement insertion for lines where `track_stock = false`.
- **M3a void:** Compensating reversals are accepted via `correlation_id`, maintaining zero net revenue and units without breaking ledger integrity.
- **Bundles:** Bundles hold no physical stock. Tracked components maintain individual ledger movements; non-tracked components maintain none.

### 4.3 Bundles and Stocktake Exclusions (Spec §9)

#### 1. Bundle Availability is Minimum over Tracked Components
- **Rule:** A bundle’s availability is `MIN(floor(component.available / bundle_line.quantity))` computed **only over components where `pv.track_stock = true`**. Non-tracked components (e.g. gift wrap, warranties) have unlimited availability and must not bound or distort the minimum. If a bundle contains only non-tracked components, its availability is `NULL` (unlimited).
- **Files Changing:**
  - `artifacts/api-server/src/routes/admin/counter-lookup.ts`: `GET /admin/counter/bundles` queries `track_stock` from `product_variants`. When calculating line and bundle availability, non-tracked components are ignored in `Math.min()`.
  - `artifacts/store/src/pages/admin/CounterPage.tsx`: Line availability badge displays `—` for non-tracked bundle items; bundle availability is bounded solely by tracked items.

#### 2. Non-Tracked Variants Never Appear on a Stocktake Count Sheet
- **Rule:** Physical stocktakes count physical items. Non-tracked variants (services, made-to-order, gift wrap) cannot be added to a stocktake.
- **Files Changing:**
  - `supabase/migrations/20261113231000_m4_track_stock_trigger_and_views.sql`: Database trigger `trg_guard_stocktake_lines_track_stock` BEFORE INSERT ON `public.stocktake_lines` verifies `pv.track_stock = true`, raising `ST034` otherwise.
  - `artifacts/api-server/src/routes/admin/stocktake-lines.ts`: `POST /admin/stocktakes/:id/lines` inspects `variant.track_stock`. If `false`, returns HTTP 400 (`"Cannot count non-tracked variant on a stocktake"`).
  - `artifacts/store/src/pages/admin/StocktakeCountPage.tsx`: Barcode scan returns `track_stock`. If false, displays inline banner: `"Item is non-tracked and cannot be added to stocktake"`.

### 4.4 Availability View & Reader Contract (Audits B2, m1)

#### 1. Column Ordering in `product_variant_availability` (Audit B2)
Postgres `CREATE OR REPLACE VIEW` forbids reordering or renaming existing columns (error `42P16`). `product_variant_public_availability` depends on `product_variant_availability`, preventing `DROP VIEW`.
- Existing live column order:
  1. `variant_id` (uuid)
  2. `product_id` (uuid)
  3. `sku` (text)
  4. `price` (numeric)
  5. `on_hand` (numeric)
  6. `reserved_quantity` (numeric)
  7. `available_quantity` (numeric)
  8. `deficit_quantity` (numeric)
- **Fix:** `track_stock` is added at **position 9 (at the end)**:
  ```sql
  CREATE OR REPLACE VIEW public.product_variant_availability AS
  SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.sku,
    pv.price,
    pv.on_hand,
    COALESCE(r.active_reserved, 0)::numeric(12,3) AS reserved_quantity,
    CASE
      WHEN pv.track_stock = false THEN NULL
      ELSE GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0))::numeric(12,3)
    END AS available_quantity,
    CASE
      WHEN pv.track_stock = false THEN 0::numeric(12,3)
      ELSE GREATEST(0, COALESCE(r.active_reserved, 0) - pv.on_hand)::numeric(12,3)
    END AS deficit_quantity,
    pv.track_stock
  FROM public.product_variants pv
  LEFT JOIN (
    SELECT variant_id, SUM(quantity) AS active_reserved
    FROM public.reservations
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
    GROUP BY variant_id
  ) r ON r.variant_id = pv.id;
  ```

#### 2. Reader Contract for Unlimited Availability as `NULL` (Audit m1)
The previous placeholder `999999` is eliminated. When `track_stock = false`, `available_quantity` is defined as `NULL`.
Every reader across the stack handles `NULL` as unlimited availability:

| Layer | File / Reader | Current Behaviour | Handling of `available_quantity = NULL` |
|---|---|---|---|
| **SQL View** | `product_variant_public_availability` | Selects `variant_id, product_id, available_quantity` | Exposes `NULL` to `anon` and `authenticated`. No leakage of `on_hand` or reserves. |
| **SQL RPC** | `get_low_stock_signals` | Compares `available <= threshold` | Excludes non-tracked variants (`WHERE pv.track_stock = true`). `NULL` never triggers low stock. |
| **SQL RPC** | `get_reorder_suggestions` | Computes `days_of_cover = available / velocity` | Excludes non-tracked variants (`WHERE pv.track_stock = true`). `NULL` never generates reorder suggestions. |
| **SQL Function** | `decrement_order_stock` | Checks `on_hand - reserved >= req_qty` | Skips check when `pv.track_stock = false`. Unlimited availability allows checkout. |
| **API** | `artifacts/api-server/src/routes/products.ts:27,83` | `availMap.set(p.id, sum + Number(row.available_quantity))` | If `row.available_quantity === null`, marks product availability as `null` (unlimited in stock). Never coerces `null` to `0`. |
| **API** | `artifacts/api-server/src/routes/categories.ts:59` | Aggregates availability for category listing | Same as `products.ts`: `null` marks category product as in stock. |
| **API** | `artifacts/api-server/src/routes/orders.ts:39` | Validates cart items against `available_quantity` | Skips stock validation when `available_quantity === null`. |
| **API** | `artifacts/api-server/src/routes/inventory.ts:105` | Formats variant availability for admin list | Returns `available: null`. Formatted as `—` (unlimited) in UI. |
| **API** | `artifacts/api-server/src/routes/admin/counter-lookup.ts:66` | Till barcode lookup | Maps `available_quantity === null ? null : Number(...)`. Till allows adding any quantity. |
| **API** | `artifacts/api-server/src/routes/admin/reservations.ts:166` | Validates stock before reservation | Rejects reservations for non-tracked items (HTTP 400: `"Cannot reserve non-tracked item"`). |
| **Storefront UI** | `artifacts/store/src/pages/storefront/ProductsPage.tsx:58,84` | Filter `.gt("available_quantity", 0)` | Filter changed to `.or("available_quantity.gt.0,available_quantity.is.null")`. Non-tracked items remain visible when "In Stock Only" is toggled. |
| **Storefront UI** | `ProductDetailPage.tsx` | Add-to-cart button and "Only N left" badge | "Add to Cart" enabled without max-quantity restriction. Suppresses "Only N left" badge when `available === null`. |
| **Admin UI** | `artifacts/store/src/pages/admin/InventoryPage.tsx` | Renders `Available` table column | Renders `—` (dash) or `t("Admin.Inventory.unlimited")` when value is `null`. Never renders `0` or `999999`. |
| **Admin UI** | `artifacts/store/src/pages/admin/CounterPage.tsx:52` | Till cart stock indicator | Hides stockout/deficit warnings for `null` availability lines. |
| **Admin UI** | `artifacts/store/src/pages/admin/DashboardPage.tsx` | Summary count cards | Low / Out of stock counts exclude variants with `null` availability. |

### 4.5 Sales & Fulfillment Functions (Audit B3)
- `decrement_order_stock`, `post_pending_counter_sale`, and `fulfil_reservation` are updated in `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql` to skip movement inserts and cost recomputations for `track_stock = false` lines.
- `post_counter_sale` is **not touched** in that file. It is defined in `supabase/migrations/20261113231200_m4_post_counter_sale_unified.sql` sequenced after `20261113230400`, carrying both payments and `track_stock` filters.

---

## 5. The Low-Stock Digest Architecture (Audit M2)

### 5.1 Root Cause in Previous Implementation
In the initial M4 attempt:
1. `POST /admin/inventory/signals/evaluate-digest` existed with no caller in the codebase (no cron, no UI action, no request hook).
2. The route inserted rows into `public.notifications` with `channel = 'in_app'`, `recipient = 'admin'`, `type = 'low_stock'`, and no UI component or store query ever read in-app rows from `public.notifications`.
3. In `artifacts/api-server/src/lib/notifications.ts`, `low_stock` was caught with `result = { ok: true }` and marked `sent`, but performed no delivery.
4. In `inventory-signals.ts`, suppression inserts and notification sends were separate un-checked database operations. A failure in suppression followed by sending repeated notifications on every evaluation call.

### 5.2 Four Architectural Questions Answered with Codebase Evidence

#### Q1. What causes an evaluation?
- **Event and Code Path:**
  In strict accordance with `AGENTS.md` (*"tens of sales a day; do not add caching, denormalisation or background jobs for volume that does not exist"*), there is **no cron job, no scheduler, and no background worker**.
  Evaluation runs **synchronously in the API request path** immediately following events that lower available inventory:
  1. *Counter Sale Posted:* `artifacts/api-server/src/routes/admin/counter-sales.ts:87`, immediately after `admin.rpc("post_counter_sale", ...)` returns `status === "posted"`.
  2. *Online Order Stock Decremented:* `artifacts/api-server/src/routes/orders.ts:125`, immediately after `decrementOrderStock(admin, orderId, orderLines, user.id)` succeeds.
  3. *Pending Counter Sale Resolved:* `artifacts/api-server/src/routes/admin/counter-sales.ts:118`, after `post_pending_counter_sale` posts movements for a previously held sale.
- **Why in Request Path:**
  For a store with tens of sales a day, stock levels only change when a sale is finalized. Running evaluation on stock-lowering request paths guarantees instant alert generation without CPU polling or standing infrastructure.

#### Q2. How does the owner learn of it without opening the admin?
- **Codebase Evidence Regarding Owner Notification Channels:**
  - `store_settings` (`supabase/migrations/20260606110418_create_store_settings.sql:12`) holds `contact_phone = '+994 55 619 59 07'`, documented as *"Contact phone shown in footer"*. This is a public-facing customer support number.
  - `artifacts/api-server/src/lib/whatsapp.ts:13` defines `const ADMIN_PHONE = process.env.ADMIN_PHONE ?? "+994556195907"`, which is formatted into customer order confirmations (`whatsapp.ts:72`: `"Sualınız üçün: ${ADMIN_PHONE}"`).
  - There is currently **no dedicated setting** in `store_settings` or `users` for receiving automated administrative push alerts.
- **The Two Outcomes Permitted by Spec §6.4:**
  Spec §6.4 allows exactly two valid designs: *handle the type, or do not queue it*.

  ##### Outcome A: WhatsApp Alerting ("Handle the Type")
  - If external delivery without opening the admin is required:
    - We add setting `owner_notification_phone` to `store_settings` (defaulting to empty string).
    - In `artifacts/api-server/src/lib/whatsapp.ts`, add `sendWhatsAppLowStockDigest(phone: string, count: number, items: Array<{ title: string; sku: string; available: number; threshold: number }>)`.
    - Message template:
      ```text
      ⚠️ [Store Name] — Aşağı Stok Xəbərdarlığı
      3 məhsul kritik həddə çatdı:
      • Qara Çanta (SKU-101): 1 ədəd qaldı (hədd: 5)
      • Ağ Köynək M (SKU-204): 0 ədəd qaldı (hədd: 3)
      • Kəmər Qəhvəyi (SKU-305): 2 ədəd qaldı (hədd: 4)
      Sifariş vermək üçün admin panelə daxil olun.
      ```
    - In `artifacts/api-server/src/lib/notifications.ts`, handle `type === "low_stock"` by invoking `sendWhatsAppLowStockDigest`.
    - If `owner_notification_phone` is not set or empty, dispatch is safely skipped.

  ##### Outcome B: "The Dashboard List is the Signal" ("Do Not Queue It")
  - If the owner checks stock primarily via the admin dashboard:
    - We plainly declare: *The owner learns of low stock upon opening the admin; the dashboard count card and inventory list are the signals.*
    - In accordance with spec §6.4 and prompt §1.2:
      1. Delete `type: "low_stock"` from `artifacts/api-server/src/lib/notifications.ts`.
      2. Delete route `POST /admin/inventory/signals/evaluate-digest`.
      3. Drop `low_stock_notification_events` suppression table from the migration plan entirely.
    - Zero dead code, zero unread rows, zero divergence risk.

  ##### Design Decision & Recommendation:
  We design **Outcome A** in full technical detail below (including transaction safety and setting definition), but explicitly provide **Outcome B** as the sanctioned zero-footprint alternative. If external WhatsApp delivery is deferred by the owner, Outcome B removes the suppression table and route cleanly without affecting core signals.

#### Q3. Where is the digest read?
- **External Surface:** The owner reads the digest directly on their phone inside the WhatsApp mobile application.
- **Audit Ledger:** In the database, the record is stored in `public.notifications` (`type = 'low_stock'`, `channel = 'whatsapp'`, `recipient = owner_phone`, `status = 'sent'`).
- **Why No In-App Component Reads It:**
  Inspection of the entire frontend confirms that `artifacts/store/src/pages/admin/OrderDetailPage.tsx:102` reads only notifications for a specific order (`/admin/orders/:id/notifications`). `NotificationCenterPage.tsx` reads control-plane platform announcements (`/platform/notifications`). There is no generic in-app notification center in the storefront or admin for store-level operational messages. Therefore, storing an `in_app` row in `public.notifications` creates an unread zombie record. Delivering to WhatsApp fulfills an actual reading surface.

#### Q4. What happens when a step fails? (Suppression & Send Atomicity)
The suppression write and the notification send must never diverge. A failed suppression followed by an external send causes duplicate alerts on every sale.
- **Order of Operations:**
  1. A single PostgreSQL RPC `evaluate_low_stock_digest(p_variant_ids uuid[])` executes in **one database transaction**:
     - Locks candidate variants.
     - Deletes suppression rows from `low_stock_notification_events` where current `available > threshold` (recovery).
     - Identifies newly low variants (`available <= threshold` AND NOT in `low_stock_notification_events`).
     - If newly low variants exist:
       - Inserts newly low variants into `low_stock_notification_events`.
       - Inserts **one** pending row into `public.notifications` (`type = 'low_stock'`, `channel = 'whatsapp'`, `recipient = owner_phone`, `status = 'pending'`, `payload = { count, items }`).
       - Returns the notification record `id` and payload.
     - If no newly low variants exist, returns `NULL`.
  2. The API route receives the pending notification record.
  3. The API invokes `sendWhatsAppLowStockDigest(ownerPhone, ...)`:
     - **If send succeeds:** Updates `public.notifications` to `status = 'sent'`, `sent_at = now()`.
     - **If send fails:** Updates `public.notifications` to `status = 'failed'`, `error_message = error`.
- **Why this eliminates divergence:**
  Because the suppression write and the pending notification record are committed together in step 1, a network failure or UltraMsg outage in step 3 **does not roll back the suppression row**. The variant remains suppressed in the database. The digest is not repeated on the next counter sale 5 minutes later. The failed notification is visible in `public.notifications` and can be retried via `/admin/notifications/:id/retry`.

### 5.3 Ordinary Flow & Edge Cases

1. **Fifteen variants cross their threshold in one day:**
   - *Case 1 (Batched in one large sale):* A counter sale sells quantities across 15 variants, dropping all 15 below threshold. `post_counter_sale` commits. In the post-sale evaluation, all 15 are identified as newly low. The database RPC creates 15 suppression rows and inserts **exactly one** digest row into `public.notifications` listing all 15 items. The owner receives **one WhatsApp message**, not 15.
   - *Case 2 (Spread across 15 separate sales throughout the day):* Sale 1 drops variant A below threshold; a digest with variant A is sent. Sale 2 drops variant B; a digest with variant B is sent. Each sale only alerts on items newly dropped below threshold during that transaction. Already-alerted items remain suppressed and are never re-sent.
2. **One variant hovers at its threshold:**
   - A variant has threshold 5 and stock 6.
   - Sale 1 sells 1 unit (stock becomes 5, which is `<= 5`). The variant is newly low. Digest is sent; suppression row is written.
   - Sale 2 sells 1 unit (stock becomes 4). Evaluation checks `low_stock_notification_events`. The variant is already present. **No notification is sent.**
   - Sale 3 sells 1 unit (stock becomes 3). **No notification is sent.**
   - Goods receipt arrives, restocking 10 units (stock becomes 13, which is `> 5`).
   - The next evaluation detects `available > threshold` and **deletes the suppression row** (recovery). Recovery sends no notification (spec §6.4: *"Recovery is not an event"*).
   - A week later, stock drops to 4. Because the suppression row was cleared, this is recognized as a new low-stock incident, and an alert is sent.

### 5.4 Intersections Met

1. **M3a Counter Sale Idempotent Replay:**
   If a till client resends `post_counter_sale` with the same `id` and `p_payload_hash`, the RPC returns the existing sale without inserting movements. Because stock was not decremented, no variants crossed threshold, and the digest evaluator finds zero newly low variants.
2. **`needs_owner` Sales That Wrote No Movement:**
   When a sale is held in `needs_owner` status (till stock deficit), `post_counter_sale` rolls back movement insertion. Ledger availability does not change immediately. Once the owner resolves the sale via `post_pending_counter_sale`, movements are posted and evaluation runs, capturing any threshold crossing accurately.
3. **M2c Reservations Expiring:**
   When a reservation expires, `available` increases. When an evaluation runs, any recovered variants have their suppression cleared. Conversely, when a new reservation is created, `available` drops, which can legitimately trigger a low-stock alert even when physical `on_hand` is unchanged.
4. **`notifications` Table Constraints:**
   - `public.notifications.recipient` has a `NOT NULL` constraint (`supabase/schema.sql:820`). Under Outcome A, `recipient` is populated with the resolved `owner_notification_phone` string.
   - `channel` defaults to `'whatsapp'`, aligning with existing messaging architecture.

---

## 6. Signals Calculation Boundary & Cost RLS Guarantee

### 6.1 RPC Specifications (Database Boundary)

#### 1. `get_low_stock_signals(p_search text DEFAULT NULL, p_status text DEFAULT NULL)`
- **Security:** `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted exclusively to `service_role`.
- **Visibility:** Staff and Admin.
- **Fields Returned:** `variant_id`, `product_id`, `title`, `sku`, `barcode`, `on_hand`, `reserved_quantity`, `available_quantity`, `threshold`, `status` (`'out'` when `available <= 0`, `'low'` when `available <= threshold`).
- **Filters:** Evaluates variants where `pv.track_stock = true`. Non-tracked variants (`available_quantity IS NULL`) are excluded.
- **Ordering:** Out-of-stock items first, then lowest available ascending.
- **Zero Cost Exposure:** No cost or value columns exist in this function.

#### 2. `get_dead_stock_signals(p_days integer DEFAULT 90)`
- **Security:** `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted exclusively to `service_role`.
- **Logic:**
  - Evaluates variants with `pv.track_stock = true` and `pv.on_hand > 0`.
  - Excludes newly onboarded variants whose first inbound movement was less than `p_days` ago (`days_since_first_receipt < p_days`).
  - **Net Sales Check (Audit M3a void):** Evaluates net units sold over the trailing window:
    ```sql
    v_net_sales := COALESCE((
      SELECT -SUM(sm.quantity_delta)
      FROM public.stock_movements sm
      WHERE sm.variant_id = pv.id
        AND sm.reason IN ('online_sale', 'counter_sale')
        AND sm.posting_date >= now() - (p_days || ' days')::interval
    ), 0);
    ```
    Variant is dead only when `v_net_sales <= 0`. A sale that was subsequently voided results in net 0 sales and remains dead.
  - Joins `variant_costs.cost_price` (schema defined in M1/M2a):
    ```sql
    v_unit_cost := COALESCE(vc.cost_price, vc.opening_cost, 0);
    v_capital := pv.on_hand * v_unit_cost;
    ```

#### 3. `get_reorder_suggestions(p_window_days integer DEFAULT 28, p_target_days integer DEFAULT 60, p_min_sales integer DEFAULT 3)`
- **Security:** `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted exclusively to `service_role`.
- **Logic:**
  - Trailing window net sales: `-SUM(sm.quantity_delta)` for `sm.reason IN ('online_sale', 'counter_sale') AND sm.posting_date >= now() - (p_window_days || ' days')::interval`.
  - Adds unposted lines from `counter_sales WHERE status = 'needs_owner'` within the window.
  - `velocity = net_units_sold / p_window_days`.
  - **Distinct Sales Count (Audit m2):** Counts distinct transactions with net positive units sold, preventing voided transactions from falsifying confidence:
    ```sql
    SELECT count(DISTINCT tx.id)
    FROM (
      SELECT COALESCE(sm.transaction_id::text, sm.reference_id) AS id
      FROM public.stock_movements sm
      WHERE sm.variant_id = pv.id
        AND sm.reason IN ('online_sale', 'counter_sale')
        AND sm.posting_date >= now() - (p_window_days || ' days')::interval
      GROUP BY 1
      HAVING -SUM(sm.quantity_delta) > 0
    ) tx
    ```
  - `has_enough_data = (sales_count >= p_min_sales)`.
  - Candidate inclusion: Includes all variants with `velocity > 0 AND (days_of_cover < p_target_days OR available <= 0)`.
  - When `has_enough_data = false`: `suggested_qty = NULL`. The row is returned with sales count so the UI renders the required "Insufficient data" badge.
  - **Supplier Resolution (Audit m3):** Returns `NULL` for `supplier_id` and `supplier_name` when no goods receipt exists, allowing the frontend to localize "Unassigned" via `t()`.

### 6.2 Express API Boundary & Cost Stripping
In `artifacts/api-server/src/routes/admin/inventory-signals.ts`:
- Route `GET /admin/inventory/signals/dead-stock` uses `requireStaffOrAdmin`.
- Express reads the session user role from `req.userRole`.
- If `role === 'admin'`: Returns full dataset with `unit_cost`, `capital_tied_up`, and `total_dead_capital`.
- If `role === 'staff'`: Iterates over records and **deletes `unit_cost` and `capital_tied_up`**, omitting `total_dead_capital`.
- Guaranteed by automated integration test asserting that no staff session can retrieve cost or capital metrics.
- **No TypeScript Fallbacks (Audit M1):** All routes call RPCs directly. Any database error returns HTTP 500 immediately.

---

## 7. UI & Frontend Integration (§10)

1. **Dashboard (`DashboardPage.tsx`):**
   - Three summary cards:
     - Low / Out of Stock count (links to `/admin/inventory?filter=low_stock`)
     - Not Selling count (links to `/admin/inventory?filter=not_selling`)
     - Reorder Suggestions count (links to `/admin/inventory/reorder`)
2. **Inventory Page (`InventoryPage.tsx`):**
   - Filters integrated into existing table:
     - `low_stock`: Monitored items where `available <= threshold`.
     - `not_selling`: Items with on-hand units and net zero sales over N days (toggleable 30, 60, 90, 180 days).
   - Value / Capital column displayed only when user is `admin`.
   - Terminology: uses "not selling" (never "dead") in all user-facing locales (`az`, `ru`, `en`).
3. **Reorder Page (`ReorderPage.tsx`):**
   - Dedicated working screen grouped by supplier.
   - Header shows supplier name and contact info for direct ordering.
   - Evidence columns: Units Sold (28d), Available, Velocity (units/day), Days of Cover, Suggested Order Qty.
   - Footnote indicating `on_order: 0 (not tracked)`.
   - Renders explicit "Insufficient data" badge (`<Badge variant="outline">{t("Admin.Reorder.insufficientData")}</Badge>`) when `sales_count < 3`.
4. **Localization:**
   - All strings localized through `t()`, keys added to `az.ts`, `ru.ts`, `en.ts`.

---

## 8. Migration Plan & File Budget (Audits B2, B3, m1)

Every migration is strictly scoped to one concern, numbered sequentially after the merged chore `20261113230400_post_counter_sale_payments.sql`.

### 8.1 Ordered Migration Sequence

1. `supabase/migrations/20261113231000_m4_track_stock_trigger_and_views.sql`
   - **Concern:** Movement trigger enforcement, tracking switch guard, and availability view column update.
   - Updates `trg_apply_stock_movement()` to raise `ST030` on non-tracked variants, allowing compensating reversals where `correlation_id` matches an existing movement.
   - Creates `trg_guard_track_stock_change()` on `product_variants` (blocks `true → false` when `on_hand <> 0`, active stocktakes exist, or reservations are active).
   - Creates `trg_guard_stocktake_lines_track_stock` on `stocktake_lines` (blocks non-tracked items on count sheets).
   - Replaces `product_variant_availability`: adds `track_stock` as column 9 (at the end), defines `available_quantity = NULL` when `track_stock = false`. Does not drop view.
2. `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql`
   - **Concern:** Fulfillment functions skip non-tracked variants.
   - Updates `post_pending_counter_sale`, `decrement_order_stock`, and `fulfil_reservation` to filter `track_stock = true`.
   - Does NOT redefine `post_counter_sale`.
3. `supabase/migrations/20261113231200_m4_post_counter_sale_unified.sql`
   - **Concern:** Single definitive definition of `post_counter_sale` (Audit B3).
   - Combines the `counter_sale_payments` insert (from chore `…230400`) and the `track_stock = true` movement filter.
   - Passes both invariants: `post-counter-sale-writes-payments` and `no-non-tracked-variant-movements`.
4. `supabase/migrations/20261113231300_m4_store_settings_signals.sql`
   - **Concern:** Operational parameters in `store_settings`.
   - Seeds `dead_stock_days` ('90'), `reorder_target_days` ('60'), `reorder_velocity_window_days` ('28'), `reorder_min_sales` ('3'), and `owner_notification_phone` ('').
5. `supabase/migrations/20261113231400_m4_low_stock_digest_schema.sql` (Under Outcome A)
   - **Concern:** Low-stock notification events suppression table.
   - Creates `low_stock_notification_events` (`variant_id`, `notified_at`, `last_notified_available`, `threshold_at_notification`) with RLS.
   - Creates atomic evaluation RPC `evaluate_low_stock_digest`.
   *(Omitted if Outcome B "dashboard is the signal" is selected).*
6. `supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql`
   - **Concern:** Signals calculation RPCs.
   - Creates `get_low_stock_signals`, `get_dead_stock_signals`, and `get_reorder_suggestions`.
   - Revoked from `public, anon, authenticated`, granted exclusively to `service_role`.

### 8.2 File Plan & Line Budget
All new files comply strictly with the 200-line budget in `AGENTS.md`:

| File | Purpose | Lines |
|---|---|---|
| `supabase/migrations/20261113231000_m4_track_stock_trigger_and_views.sql` | Triggers & availability view | ~140 |
| `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql` | Sales & fulfillment functions | ~150 |
| `supabase/migrations/20261113231200_m4_post_counter_sale_unified.sql` | Definitive `post_counter_sale` | ~130 |
| `supabase/migrations/20261113231300_m4_store_settings_signals.sql` | Store settings seeds | ~35 |
| `supabase/migrations/20261113231400_m4_low_stock_digest_schema.sql` | Suppression table & atomic RPC | ~90 |
| `supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql` | Three calculation RPCs | ~180 |
| `artifacts/api-server/src/routes/admin/inventory-signals.ts` | Express router for signals | ~170 |
| `artifacts/store/src/pages/admin/ReorderPage.tsx` | Reorder working table | ~190 |
| `artifacts/store/src/__tests__/m4-stock-signals.unit.test.ts` | Unit tests for signals & formula | ~165 |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | Integration tests for DB triggers & RBAC | ~185 |

Existing files modified:
- `artifacts/api-server/src/routes/admin/counter-lookup.ts` (+15 lines): Bundles availability over tracked components.
- `artifacts/api-server/src/routes/admin/stocktake-lines.ts` (+10 lines): Rejects non-tracked variants on stocktakes.
- `artifacts/api-server/src/lib/notifications.ts` (+20 lines): WhatsApp low-stock digest handler (Outcome A) or type removal (Outcome B).
- `artifacts/store/src/pages/admin/InventoryPage.tsx` (+45 lines): Table filter integration for low stock and not selling.
- `artifacts/store/src/pages/admin/DashboardPage.tsx` (+25 lines): Summary count cards.
- `artifacts/store/src/pages/admin/CounterPage.tsx` (+15 lines): Handle NULL available and bundle line exclusions.
- `artifacts/store/src/lib/i18n/messages/az.ts`, `ru.ts`, `en.ts` (+35 keys each).

---

## 9. Definition of Done & Verification Strategy

1. **Local Test Tiers (Offline local checkout):**
   - `pnpm run audit:invariants` passes cleanly, including `post-counter-sale-writes-payments` and `no-non-tracked-variant-movements`.
   - `pnpm test:unit` passes (all offline unit tests green).
   - `pnpm run typecheck` passes with 0 errors across all workspace packages.
2. **CI Integration Tier (Against Test Supabase Project):**
   - Trigger `trg_apply_stock_movement` raises `ST030` when attempting new movements for `track_stock = false` variants.
   - Compensating void reversal on a non-tracked variant succeeds; `verify_stock_integrity()` returns 0 discrepancies.
   - Switching `track_stock` from `true` to `false` is rejected if `on_hand <> 0`, active stocktakes exist, or reservations are active.
   - Bundles calculate availability strictly over tracked components.
   - Non-tracked variants are blocked from stocktake count sheets.
   - `product_variant_availability` reports `available_quantity = NULL` for non-tracked variants; public view exposes `NULL` to `anon`.
   - Express `/admin/inventory/signals/dead-stock` returns 200 with all cost and valuation columns stripped for staff callers.
3. **Audit Readiness:**
   - Applied solely on `m4/stock-signals-core` without touching `main` or production databases.
   - Single commit for this revision touching only this document.
