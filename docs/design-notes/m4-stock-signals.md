# M4 Design Note: Stock Signals (Low Stock, Reorder Suggestions, Dead Stock)

> **Phase Branch:** `m4/stock-signals`  
> **Spec:** `docs/tasks/warehouse-m4-stock-signals.md`  
> **Domain Rules:** `.agents/rules/inventory.md`, `.agents/rules/migrations.md`, `.agents/rules/frontend.md`  
> **Status:** Drafted for review by the owner / architect (@coordinator) and verifier (@verifier). Adheres strictly to the Step 1 design-note gate.

---

## 1. The Shape in One Paragraph

Stock signals in Phase M4 answer the owner's three standing commercial questions—*What am I about to run out of?*, *What is my money sitting in that nobody is buying?*, and *What should I order and how much?*—strictly as **derived read-time calculations** from the append-only movement ledger and active reservations, without storing any computed signal column on `product_variants`. The phase begins by closing the latent `track_stock` defect in the database apply trigger (`trg_apply_stock_movement`), ensuring non-tracked variants cannot record movements while selling smoothly at the till without decrementing stock. Low stock compares database-enforced `available` stock against resolved per-variant or global thresholds, dispatches a single batched in-app digest per incident without re-alerting during sustained low stock, and fixes the unhandled `low_stock` notification branch in `notifications.ts`. Dead stock ("not selling") identifies variants with on-hand units and zero sales over a configurable window (default 90 days), calculating capital tied up from M2a weighted average cost while strictly stripping all cost and value metrics for staff roles. Reorder suggestions calculate trailing sales velocity from outbound sale ledger movements, displaying honest formula evidence (velocity, days of cover, sales count) and omitting suggestions when sales data is insufficient.

---

## 2. Answers to Spec §13 (Open Questions with Concrete Codebase Evidence)

### Q1. Is there an "on order" quantity at all?
- **Codebase Evidence:**
  - `goods_receipts` table (`supabase/migrations/20261104100000_m2a_schema_tables.sql:57`) has `status CHECK (status IN ('draft', 'posted', 'reversed'))`. A `draft` receipt is an intake document created when counting boxes physically arriving at the store door; it does not represent an open purchase order placed with a vendor.
  - In `prompts/m2a-design-revise.md`: `"- 'reference_type = 'purchase_order'' for a goods-receipt movement. There are no purchase orders in the product..."`.
  - While `reference_type` in `stock_movements` permits `'purchase_order'`, design note `docs/design-notes/m1-variants-ledger.md:20` explicitly states: `reference_id text is deliberately unenforced by foreign keys because it points polymorphically to orders.id, or future purchase_orders.id`. No `purchase_orders` table has ever been created.
  - Spec §3 and §17 state: *"There is no buyer, no procurement process and no supplier portal — 'ordering' means the owner messages a supplier"* and *"Not in M4: Purchase-order generation, supplier emails, or any outbound ordering"*.
- **Decision:** No expected-but-not-received "on order" state exists anywhere in the schema. In accordance with §13 Q1 (*"drop the term from the formula and say so on screen, or justify adding the state — do not invent a column quietly"*), we **drop `on_order` from the suggested quantity formula** (or treat `on_order = 0`) and explicitly display `on_order: 0 (not tracked)` on the reorder screen next to the calculation breakdown. We do not invent an unbacked column.

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
  A centralized server-side helper `getInventorySettings()` reads `store_settings` with typed parsing and robust numeric fallbacks, ensuring existing code and routes continue working without schema divergence.

### Q4. Database or application?
- **Codebase Evidence:**
  - Availability is calculated in the database via `product_variant_availability` (`supabase/migrations/20261104184000_m2c_availability_view.sql`).
  - Multi-table reporting with cost/revenue calculations uses PostgreSQL security-definer RPCs, notably `get_margin_report` (`supabase/migrations/20261111120800_margin_report_live_schema.sql`).
  - Express routes act as authenticated gatekeepers (e.g. `artifacts/api-server/src/routes/admin/margins.ts`), enforcing RBAC and invoking RPCs via `service_role`.
- **Decision:** Consistent with this architecture:
  - **Database RPCs:** The heavy ledger joins, aggregations, and cost lookups are implemented as database functions (`get_low_stock_signals`, `get_dead_stock_signals`, `get_reorder_suggestions`). Direct client access is revoked (`REVOKE ... FROM public, anon, authenticated`) and granted strictly to `service_role`.
  - **Application API Layer:** Express endpoints (`/admin/inventory/signals/...`) authenticate caller sessions. For dead stock, Express verifies `req.admin.role`: if `admin`, cost and capital tied up are returned; if `staff`, cost and valuation fields are stripped from all line items and totals before JSON serialization.

### Q5. Does any variant have `track_stock = false` today?
- **Codebase Evidence:**
  - `track_stock` was added in `20261103210000_m1_schema_additions.sql` with `boolean NOT NULL DEFAULT true`.
  - Inspection of all migrations, seeds (`scripts/seed-test-data.ts`), and unit test fixtures shows zero variants seeded with `track_stock = false`.
  - In a standard database instance, all existing variants have `track_stock = true`.
- **Decision & Migration Backfill Guarantee:**
  - The migration will run an explicit pre-check query:
    ```sql
    -- Assert existing data state and clean any stray movements if test variants exist
    DO $$
    DECLARE
      v_non_tracked_count integer;
    BEGIN
      SELECT count(*) INTO v_non_tracked_count FROM public.product_variants WHERE track_stock = false;
      RAISE NOTICE 'Existing non-tracked variants count: %', v_non_tracked_count;
    END $$;
    ```
  - For existing historical rows, ledger immutability is strictly respected: past movements are never deleted or modified.
  - If any existing variant has `track_stock = false`, any non-zero `on_hand` is recognized as a legacy artifact. However, availability views and stock decrements will immediately treat non-tracked variants as having unlimited availability and bypass movement creation going forward.

### Q6. Units of measure and `ceil` on suggested quantity
- **Codebase Evidence:**
  - `product_variants.unit_of_measure` (`20261102100000_m1_variants_ledger.sql`) defaults to `'pcs'`.
  - Domain rule `.agents/rules/inventory.md:45-48` notes: *"Quantity columns are numeric with scale, not integers — a later customer will sell by weight or length. The admin UI does not expose fractional entry until a customer needs it."*
- **Decision:**
  - For discrete units (`pcs`, `box`, `pair`, `set`, etc.), whole units must be ordered from suppliers. `ceil(target_days * velocity - available)` guarantees that the target days of cover is fully satisfied without rounding down into a stockout.
  - For continuous units (`kg`, `m`, `l`), `ceil` rounds up to the nearest integer unit (e.g. 14 m or 15 kg). While continuous goods *could* support fractional ordering if a supplier accepted decimals, in small-shop retail ordering (spec §3), suppliers package materials in discrete rolls, bags, or whole units. Rounding down (`floor`) would violate the target cover horizon. Therefore, `ceil` is mathematically sound and operationally standard for all units of measure in this phase.

---

## 3. Ordinary Flow and Intersections (§12)

Every rule introduced in Phase M4 is detailed below with its ordinary-flow behavior and its exact intersections with earlier architectural decisions.

| # | This Phase's Rule | Intersects | Ordinary-Flow Behaviour & Earlier Decisions Met |
|---|---|---|---|
| 1 | Signals read `available` | M2c reservations (`m2c-reservations.md`) | In ordinary flow, a customer deposit creates an active reservation in `public.reservations`. Physical `on_hand` remains unchanged, but `available` (`on_hand - reserved`) decreases. Low stock triggers when `available <= threshold`, correctly alerting the owner before physical stock is fully depleted. Meets M2c rule: reservations reduce available, not on hand. |
| 2 | Velocity from movements | M3a void (`m3-counter-sale.md`) | In ordinary flow, a counter sale writes a movement (`quantity_delta = -N`, `reason = 'counter_sale'`). When voided via `void_counter_sale`, a compensating movement is inserted at the original `posting_date` (`quantity_delta = +N`). The velocity query computes net units sold as `-SUM(quantity_delta)` for `reason IN ('online_sale', 'counter_sale')`. The compensating movement cancels the voided sale algebraically without special casing. |
| 3 | Velocity from movements | M3a `needs_owner` (`m3-counter-sale.md`) | In ordinary flow, a counter sale flagged as `needs_owner` (due to till stock deficit) represents goods handed to the customer. However, `post_counter_sale` holds movement insertion in an exception block until the owner resolves it via `post_pending_counter_sale`. To ensure velocity honestly reflects physical demand before the owner clicks resolve, velocity queries both posted ledger sale movements AND lines from pending `counter_sales WHERE status = 'needs_owner'`. Once posted, the sale enters `stock_movements` and drops from the pending set, preventing double counting. If voided, it leaves both sets. |
| 4 | Velocity excludes corrections | M2b stocktake (`m2b-stocktake.md`) | In ordinary flow, stocktake reconciliation writes `stocktake_correction` movements (`quantity_delta < 0` for shrinkage). Shrinkage is loss, not sales demand. Velocity strictly filters `reason IN ('online_sale', 'counter_sale')`, excluding stocktake corrections, manual adjustments, damage write-offs, and receipts. |
| 5 | Dead-stock value | M2a cost RLS (`m2a-receiving-cost.md`) | In ordinary flow, dead stock calculates capital tied up as `on_hand * current_cost` using M2a weighted average cost. In accordance with M2a RLS boundary, cost data is restricted to `admin`. The database RPC is granted only to `service_role`. Express inspects the session user role: for `admin`, value columns are returned; for `staff`, `unit_cost` and `total_capital` are stripped before response transmission. |
| 6 | Dead-stock "days since last sale" | M2b opening count (`m2b-stocktake.md`) | In ordinary flow, newly onboarded items entered via opening count or goods receipt have zero sales. If evaluated against a 90-day window without a floor, a new product received 5 days ago would falsely appear "dead". The dead stock query establishes an onboarding floor: a variant is only evaluated for dead stock if `days_since_first_received >= N` (window days). |
| 7 | Low stock on components | M3a minimal bundle (`inventory.md:51`) | In ordinary flow, bundles are virtual sets with zero physical stock of their own. Stock signals run exclusively on `product_variants`. Components trigger low-stock alerts individually. The bundle’s public availability naturally mirrors `MIN(available / qty)` of its tracked components. |
| 8 | `track_stock` rejection in apply trigger | M1 ledger immutability (`inventory.md:17`) | In ordinary flow, non-tracked variants (services, custom gift wrapping) do not maintain inventory. `trg_apply_stock_movement` evaluates `track_stock` BEFORE insert and raises `ST030` if an insert is attempted. Ledger immutability is preserved: existing movements are untouched, and failed inserts leave no partial rows. Counter sale and online checkout bypass movement creation for non-tracked lines. |
| 9 | Every new table and view | Multi-tenant RLS (`AGENTS.md`) | New table `low_stock_notification_events` has RLS enabled with explicit owner-only policies. Views are created with `security_invoker = true` and no public grants. |
| 10 | Reorder suggestions with negative availability | M2c reservations & M3a till overrides | If a variant is in deficit (`available < 0`), `days_of_cover` is clamped to `0`. In `suggested_qty = ceil(target_days * velocity - available)`, subtracting negative available correctly adds the deficit to the order quantity, ensuring reorder covers both outstanding commitments and the target horizon. |
| 11 | Digest suppression vs stock recovery | Spec §6.4 alert discipline | When a variant drops below threshold, a suppression event is stored in `low_stock_notification_events`. If inventory is restocked such that `available > threshold`, the suppression row is deleted. Recovery itself sends no notification. When stock subsequently drops below threshold again, a new alert is generated. |

---

## 4. Defect Fix 1: `track_stock` Enforcement (§9)

### 4.1 Root Cause in Current Codebase
In `20261103210000_m1_schema_additions.sql`, `product_variants.track_stock` was defined as `boolean NOT NULL DEFAULT true`. However:
1. `trg_apply_stock_movement()` (`20261104190000_m2c_trigger_bypass_reasons.sql`) never reads `track_stock`. Any insert to `stock_movements` updates `product_variants.on_hand` regardless of whether `track_stock` is false.
2. `post_counter_sale()` (`20261111120400_m3_post_counter_sale.sql:129-133`) unconditionally attempts to insert movements for all `counter_sale_lines`.
3. `decrement_order_stock()` (`20261111110100_m2c_sales_recompute_cost.sql:79-92`) unconditionally checks stock availability and inserts movements for all order lines.
4. `product_variant_availability` view (`20261104184000_m2c_availability_view.sql`) reports `on_hand` and `available_quantity = GREATEST(0, on_hand - reserved)` without considering `track_stock`.

### 4.2 Database Trigger Fix
Update `trg_apply_stock_movement()` to verify `track_stock` immediately upon invocation:
```sql
-- Inside trg_apply_stock_movement() BEFORE INSERT:
DECLARE
  v_track_stock boolean;
BEGIN
  SELECT track_stock INTO v_track_stock
  FROM public.product_variants
  WHERE id = NEW.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
  END IF;

  IF NOT v_track_stock THEN
    RAISE EXCEPTION 'Stock movements cannot be created for non-tracked variant %', NEW.variant_id
      USING ERRCODE = 'ST030';
  END IF;
  -- Proceed with existing negative stock and availability checks...
```

### 4.3 Counter Sale & Order Decrement Fix
In `post_counter_sale` and `post_pending_counter_sale`:
```sql
-- Only insert movements for tracked variants:
INSERT INTO public.stock_movements (
  variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id, posting_date, actor_id
)
SELECT csl.variant_id, -csl.quantity, 'counter_sale', 'counter_sale', v_id::text, v_id, v_posting, p_session_user
FROM public.counter_sale_lines csl
JOIN public.product_variants pv ON pv.id = csl.variant_id
WHERE csl.sale_id = v_id AND pv.track_stock = true
ORDER BY csl.line_no;

-- Only recompute cost for tracked variants:
FOR v_var IN
  SELECT DISTINCT csl.variant_id
  FROM public.counter_sale_lines csl
  JOIN public.product_variants pv ON pv.id = csl.variant_id
  WHERE csl.sale_id = v_id AND pv.track_stock = true
  ORDER BY 1
LOOP
  PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
END LOOP;
```
In `decrement_order_stock`:
Filter out `track_stock = false` variants from availability lock checks, movement inserts, and cost recomputations.

### 4.4 Availability View & Stocktake Fix
1. Update `product_variant_availability`:
   Expose `track_stock`. When `track_stock = false`, `available_quantity` is defined as `NULL` (or unlimited indicator in API), and `deficit_quantity = 0`.
2. Stocktake count sheet generation:
   Filter queries generating `stocktake_lines` with `WHERE pv.track_stock = true`, ensuring non-tracked items never appear on physical inventory count sheets.

---

## 5. Defect Fix 2: `low_stock` in `notifications.ts` (§6.4)

### 5.1 Root Cause in Current Codebase
In `artifacts/api-server/src/lib/notifications.ts:40-53`:
```typescript
let result: { ok: boolean; error?: string } = { ok: false, error: "unhandled type" };
try {
  if (type === "order_confirmed") {
    result = await sendWhatsAppOrderConfirmed(...);
  } else if (type === "status_changed") {
    result = await sendWhatsAppStatusUpdate(...);
  }
  // type === "low_stock" is NEVER handled!
  // It falls through, notifId is marked status = "failed" with error_message = "unhandled type".
```
Furthermore, `channel` is hardcoded to `"whatsapp"`, violating §5.6 and §17 ("in-app first; WhatsApp per-variant alerting is explicitly not in this phase").

### 5.2 Resolution Plan
1. **Extend Notification Channels:**
   Update `queueNotification` options to support `channel?: "whatsapp" | "in_app"`. Default `low_stock` notifications to `channel = "in_app"`.
2. **Explicit Type Handling:**
   In `notifications.ts`:
   ```typescript
   if (type === "low_stock") {
     // Handled as in-app notification; no external WhatsApp API call required
     result = { ok: true };
   }
   ```
   When `result.ok` is true, the record in `public.notifications` is marked `status = 'sent'` with `sent_at = now()`.
3. **Digest & Suppression Engine:**
   Create table `low_stock_notification_events`:
   ```sql
   CREATE TABLE public.low_stock_notification_events (
     variant_id uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
     notified_at timestamptz NOT NULL DEFAULT now(),
     last_notified_available numeric(12,3) NOT NULL,
     threshold_at_notification numeric(12,3) NOT NULL
   );
   ALTER TABLE public.low_stock_notification_events ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Admin only low_stock_notification_events"
     ON public.low_stock_notification_events FOR ALL TO authenticated
     USING (public.is_admin()) WITH CHECK (public.is_admin());
   ```
4. **Digest Trigger Execution:**
   When the low stock notification evaluator runs:
   - Identify candidate monitored variants where `pv.track_stock = true` and `available <= COALESCE(pv.low_stock_threshold, global_threshold)`.
   - Clear suppression: delete rows from `low_stock_notification_events` where the variant's current `available > threshold` (recovery).
   - Filter to unalerted variants: candidates not present in `low_stock_notification_events`.
   - If count > 0:
     - Record unalerted variants in `low_stock_notification_events`.
     - Insert **exactly one** digest row into `notifications`:
       ```json
       {
         "type": "low_stock",
         "channel": "in_app",
         "payload": {
           "count": 3,
           "items": [
             { "variant_id": "...", "sku": "MUG-BLU", "title": "Ceramic Mug", "available": 2, "threshold": 5 }
           ]
         }
       }
       ```

---

## 6. Signals Calculation Boundary & Cost RLS Guarantee

### 6.1 RPC Specifications (Database Boundary)

#### 1. `get_low_stock_signals(p_search text DEFAULT NULL, p_status text DEFAULT NULL)`
- **Visibility:** Staff and Admin.
- **Fields Returned:** `variant_id`, `product_id`, `title`, `sku`, `barcode`, `on_hand`, `reserved_quantity`, `available_quantity`, `threshold`, `status` (`'out'` when `available <= 0`, `'low'` when `available <= threshold`).
- **Order:** Out-of-stock items first, then lowest available ascending.
- **Zero Cost Exposure:** No cost or value columns exist in this function.

#### 2. `get_dead_stock_signals(p_days integer DEFAULT 90)`
- **Security:** `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted exclusively to `service_role`.
- **Logic:**
  - Evaluates variants with `pv.track_stock = true` and `pv.on_hand > 0`.
  - Excludes newly onboarded variants whose first inbound movement (`goods_receipt`, `opening_balance`) was less than `p_days` ago.
  - Excludes variants with any outbound sale movement (`online_sale`, `counter_sale`) within the trailing `p_days`.
  - Calculates `days_since_last_sale` (`now() - MAX(posting_date)`) and `days_since_first_receipt` (`now() - MIN(posting_date)`).
  - Joins `variant_costs.current_cost` to compute `capital_tied_up = pv.on_hand * vc.current_cost`.

#### 3. `get_reorder_suggestions(p_window_days integer DEFAULT 28, p_target_days integer DEFAULT 60, p_min_sales integer DEFAULT 3)`
- **Security:** `SECURITY DEFINER`, revoked from `public, anon, authenticated`, granted exclusively to `service_role`.
- **Logic:**
  - Trailing window: calculates net units sold as `-SUM(sm.quantity_delta)` for `sm.reason IN ('online_sale', 'counter_sale') AND sm.posting_date >= now() - (p_window_days || ' days')::interval`.
  - Adds unposted lines from `counter_sales WHERE status = 'needs_owner'` within the window.
  - `velocity = net_units_sold / p_window_days`.
  - `has_enough_data = (sales_count >= p_min_sales)`.
  - `days_of_cover = CASE WHEN velocity > 0 THEN GREATEST(0, available) / velocity ELSE NULL END`.
  - `suggested_qty = CASE WHEN has_enough_data AND velocity > 0 THEN GREATEST(0, ceil(p_target_days * velocity - available)) ELSE 0 END`.
  - Supplier resolution: joins the most recent posted `goods_receipt` for the variant to determine `supplier_id`, `supplier_name`, and `supplier_contact`. If never received via goods receipt, supplier is marked `Unassigned`.

### 6.2 Express API Boundary & Cost Stripping
In `artifacts/api-server/src/routes/admin/inventory-signals.ts`:
- Route `GET /admin/inventory/signals/dead-stock` uses `requireStaffOrAdmin`.
- Express reads the session user's role from the verified auth token.
- If `role === 'admin'`:
  - Returns full dataset with `unit_cost`, `capital_tied_up`, and `total_dead_capital`.
- If `role === 'staff'`:
  - Iterates over all variant records and **deletes `unit_cost` and `capital_tied_up`**.
  - Sets `total_dead_capital = null` or omits it entirely from the response.
- Guaranteed by an automated integration test asserting that no staff session can retrieve cost or capital metrics.

---

## 7. UI & Frontend Integration (§10)

1. **Dashboard (`DashboardPage.tsx`):**
   - Three summary cards displaying:
     - Low / Out of Stock count (links to `/admin/inventory?filter=low_stock`)
     - Not Selling count (links to `/admin/inventory?filter=not_selling`)
     - Reorder Suggestions count (links to `/admin/inventory/reorder`)
2. **Inventory Page (`InventoryPage.tsx`):**
   - Filters integrated into existing `<DataTable>`:
     - `low_stock`: Monitored items where `available <= threshold`.
     - `not_selling`: Items with on-hand units and zero sales over N days (toggleable 30, 60, 90, 180 days).
   - Value column displayed only when user is `admin`.
   - Strictly no hardcoded strings; all labels use `t("Admin.Inventory...")`.
   - Terminology: uses "not selling" (never "dead") in all user-facing locales (`az`, `ru`, `en`).
3. **Reorder Page (`ReorderPage.tsx`):**
   - Dedicated working screen grouped by supplier.
   - Header shows supplier name and contact info (phone/email) for direct ordering.
   - Evidence columns: Units Sold (28d), Available, Velocity (units/day), Days of Cover, Suggested Order Qty.
   - Explanatory footnote indicating `on_order: 0 (not tracked)`.
   - Insufficient data warning when sales count < 3.

---

## 8. File Plan & Line Budget

All newly created files are kept under 200 lines in strict compliance with the house rule. Existing modified files over 200 lines are justified below.

### 8.1 Files to Create
1. `supabase/migrations/20261113220000_m4_track_stock_trigger.sql` (~130 lines)  
   Enforces `track_stock = false` movement rejection in `trg_apply_stock_movement`; updates `post_counter_sale`, `post_pending_counter_sale`, and `decrement_order_stock` to skip non-tracked variants.
2. `supabase/migrations/20261113220100_m4_store_settings_signals.sql` (~35 lines)  
   Seeds operational signal settings into `store_settings`.
3. `supabase/migrations/20261113220200_m4_low_stock_digest_schema.sql` (~45 lines)  
   Creates `low_stock_notification_events` table with RLS.
4. `supabase/migrations/20261113220300_m4_stock_signals_rpcs.sql` (~180 lines)  
   Defines `get_low_stock_signals`, `get_dead_stock_signals`, and `get_reorder_suggestions` RPCs with service_role grants.
5. `artifacts/api-server/src/routes/admin/inventory-signals.ts` (~190 lines)  
   Express router handling dashboard summary, low stock, dead stock (with staff cost stripping), reorder suggestions, and digest trigger.
6. `artifacts/store/src/pages/admin/ReorderPage.tsx` (~195 lines)  
   Supplier-grouped reorder screen with formula breakdown and honesty indicators.
7. `artifacts/store/src/__tests__/m4-stock-signals.unit.test.ts` (~160 lines)  
   Unit tests for threshold resolution, velocity calculation, reorder formula, and suppression logic.
8. `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` (~180 lines)  
   Integration tests for `ST030` non-tracked movement rejection, staff cost masking, and low-stock digest dispatch.

### 8.2 Files to Modify
1. `artifacts/api-server/src/lib/notifications.ts` (+20 lines, total ~105 lines)  
   Fixes `low_stock` unhandled type and supports in-app notification dispatch.
2. `artifacts/api-server/src/index.ts` (+5 lines, total ~70 lines)  
   Mounts the new inventory signals router.
3. `scripts/audit/check-invariants.mjs` (+25 lines, total ~725 lines)  
   Adds mechanical invariant: no code path writes movements for `track_stock = false` variants.
4. `artifacts/store/src/pages/admin/InventoryPage.tsx` (+40 lines, total ~510 lines)  
   *Justification for >200 lines:* Existing 478-line admin table. We only integrate the low_stock and not_selling filters and dynamic threshold resolution; table layout logic is preserved without adding external dependencies.
5. `artifacts/store/src/pages/admin/DashboardPage.tsx` (+25 lines, total ~180 lines)  
   Integrates summary count cards and navigation links for stock signals.
6. `artifacts/store/src/App.tsx` (+4 lines, total ~95 lines)  
   Registers `/admin/inventory/reorder` route.
7. `artifacts/store/src/lib/i18n/messages/az.ts`, `ru.ts`, `en.ts` (+35 keys each)  
   Localization keys for all signals UI, table columns, tooltips, and empty states.

---

## 9. Definition of Done & Verification Strategy

1. **Local Test Tiers (Offline local checkout):**
   - `pnpm run audit:invariants:strict` passes (including new non-tracked movement invariant).
   - `pnpm test:unit` passes (all unit tests green, including M4 signal logic and i18n consistency).
   - `pnpm run typecheck` passes cleanly across all workspace packages.
2. **CI Integration Tier (Against Test Supabase Project):**
   - Database trigger correctly raises `ST030` on attempting to insert a movement for a `track_stock = false` variant.
   - Counter sale with a `track_stock = false` line completes successfully, records line revenue, and creates zero ledger movements.
   - Staff JWT query to `/admin/inventory/signals/dead-stock` returns HTTP 200 with all cost and valuation columns stripped.
   - Low stock notification digest queues exactly one digest notification for multiple low variants and suppresses re-notifying until recovery.
3. **No Migration on Production:**
   - Applied only to test Supabase environment; zero edits to `docs/tasks/`.
