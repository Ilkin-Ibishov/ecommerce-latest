# Phase M2c — Implementation Notes

**Date:** 2026-11-04  
**Branch:** `m2c/reservations`  
**Spec:** `docs/tasks/warehouse-m2c-reservations.md`  
**Prompt:** `prompts/m2c-implement.md`  
**Design Note Reference:** `docs/design-notes/m2c-reservations.md`  

---

## 1. Executive Summary & Core Invariant

Phase M2c implements the reservations (deposits) ledger, concurrency control for competing cart sales, unified availability computation with deficit exposure, anonymous token security boundaries, counter deposit creation under 1 minute, and the store owner's aged reservations review.

### Cardinal Invariant: "A Reservation is NOT a Movement"
- Creating, modifying, or expiring a reservation writes **strictly 0 rows** to `public.stock_movements`. Physical on-hand stock ($H$) represents physical units on the shelf and remains unchanged until physical goods depart the store.
- Only physical exits (`online_sale`, `counter_sale`) or physical stock adjustments write movements to the ledger.
- This invariant is mechanically enforced across migrations, routes, and client queries by the automated audit invariant `reservations-are-not-movements`.

### Concurrency & Locking Proof
- Multi-item checkout race conditions are eliminated by `decrement_order_stock(p_order_id, p_lines, p_actor_id)`:
  - Variant IDs are locked via `SELECT ... FOR UPDATE` in **strictly ascending lexicographical order**, preventing cyclic deadlocks between intersecting carts.
  - Under PostgreSQL `READ COMMITTED` isolation, acquiring a row-level lock forces the transaction to re-read the latest committed row version. When two concurrent transactions race for the last available unit ($A = 1$), the first acquires the lock, verifies $A \ge 1$, decrements stock, and commits. The second transaction waits for the lock, re-reads the updated committed row ($A = 0$), detects insufficient available stock, and raises `ST014`, rolling back completely with zero written movements.

---

## 2. Changes per Item

### C1 — Atomic Multi-Item Order Decrement (`95c9cd2`)
- **Problem:** Decrementing multi-line orders in a JavaScript loop with best-effort rollback meant mid-loop failures (especially common with `ST014` availability checks) left partial stock mutations.
- **Implementation:**
  - Migration `20261104181000_m2c_order_stock_decrement.sql`: Added `decrement_order_stock` RPC that locks each variant `FOR UPDATE` in ascending ID order, checks availability for all lines, and inserts movements in a single atomic database transaction. Any line failing aborts the entire order and writes nothing.
  - Exported `decrementOrderStock` in `artifacts/api-server/src/lib/rpc.ts`.
  - Refactored `artifacts/api-server/src/routes/orders.ts` to call `decrementOrderStock` in a single database call, retaining `decrementStockSafe` exported for backward compatibility.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-order.test.ts`.

### C2 — Single-Transaction Pay-and-Collect Fulfilment (`ed6914b`)
- **Problem:** Requiring `paid_amount == agreed_price` prior to fulfilment forced counter staff to execute two disconnected operations at customer pickup (record payment, then fulfil).
- **Implementation:**
  - Migration `20261104182000_m2c_deposit_fulfilment.sql`: Created `fulfil_reservation(p_reservation_id, p_actor_id, p_final_payment)` RPC that applies final payment and fulfilment in one atomic transaction. After applying `p_final_payment`, `paid_amount` must equal `agreed_price`, otherwise `ST015` is raised naming the exact shortfall.
  - Exported `fulfilReservation` in `artifacts/api-server/src/lib/rpc.ts`.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-fulfilment.test.ts`.

### C3 — Database-Computed `effective_status` (`f1e1a1e`)
- **Problem:** Allowing "active but expired" to mean different things across the aged list, deposit counter, and storefront risked state divergence.
- **Implementation:**
  - Migration `20261104183000_m2c_effective_status.sql`: Created `public.reservations_view` computing `effective_status` once in SQL (`released` and `fulfilled` pass through; `active` with `expires_at < now()` becomes `expired`; otherwise `active`).
  - Stored `status` column remains the record of what was explicitly acted upon.
  - All API routes and admin UI views read and return `effective_status`.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-effective-status.test.ts`.

### C4 — Unified Availability View with Deficit Exposure (`4520546`)
- **Problem:** The storefront requires clamped availability ($\max(0, H - R)$), whereas store operations require seeing when promises exceed stock ($H < R$).
- **Implementation:**
  - Migration `20261104184000_m2c_availability_view.sql`: Created `public.product_variant_availability` view exposing:
    - `reserved_quantity`: Sum of effectively-active reservations.
    - `available_quantity`: $\max(0, H - R)$, customer-facing availability.
    - `deficit_quantity`: $\max(0, R - H)$, operational shortfall.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-availability-view.test.ts`.

### C5 — Public Availability Grant & Column Privacy (`3cad4c2`)
- **Problem:** Granting `anon` direct `SELECT` on `product_variant_availability` leaks internal reservation quantities and business margins to public storefront scrapers.
- **Implementation:**
  - Migration `20261104185000_m2c_public_availability_grant.sql`:
    - Full view `product_variant_availability` is restricted to `authenticated` and `service_role`.
    - Created `public.product_variant_public_availability` exposing only `variant_id, product_id, available_quantity`. Granted to `anon`.
  - Added executable invariant `no-private-columns-on-anon-grants` in `scripts/audit/check-invariants.mjs` preventing any table/view granted to `anon` from exposing columns matching `/reserved|deficit|cost|margin/i`.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-public-grant.test.ts`.

### C6 — Deliberate Availability Trigger Bypass Reasons (`e404dc8`)
- **Problem:** Unstated omissions in trigger checks risk future implementers misunderstanding design intentions.
- **Implementation:**
  - Migration `20261104190000_m2c_trigger_bypass_reasons.sql`: Annotated `trg_apply_stock_movement` with a concise comment block naming every movement reason that deliberately bypasses availability checks and why:
    - `counter_sale`: Customer is at the till with the physical unit present; M3 records the override.
    - `stocktake_correction` & `opening_balance`: Physical observation outranks a promise.
    - `damage_write_off` & `return_to_supplier`: The physical unit is gone.
    - `manual_adjustment`: Owner's explicit operational correction.
    - `customer_return` & `goods_receipt`: Inbound stock increases on-hand.
  - Documented the same 3-line rationale in `.agents/rules/inventory.md`.
  - Enforced fulfilment ordering: `fulfil_reservation` sets the reservation to `fulfilled` *before* inserting the `counter_sale` movement so the fulfilled hold does not count against its own fulfilment.
  - Added unit test in `artifacts/store/src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts`.

### §12.3 & §12.4 — API Specification, Codegen, & Routes (`8ebd7cf`, `8718abe`)
- Added reservation schemas and `/admin/reservations` endpoints in `lib/api-spec/openapi.yaml`.
- Executed Orval codegen to generate React Query hooks and Zod schemas.
- Implemented `artifacts/api-server/src/routes/admin/reservations.ts`:
  - `POST /admin/reservations`: Fast deposit creation.
  - `GET /admin/reservations`: Filtered reservation list with `effective_status`.
  - `GET /admin/reservations/aged`: Owner aged list filtered by threshold days.
  - `POST /admin/reservations/:id/payment`: Staff-accessible installment recording up to `agreed_price`.
  - `POST /admin/reservations/:id/fulfil`: One-click pay-and-collect via `fulfilReservation` RPC.
  - `POST /admin/reservations/:id/release`: Owner-only release requiring mandatory `release_reason`.
  - `PATCH /admin/reservations/:id/price`: Owner-only price renegotiation (403 for staff).

### §12.5 — Storefront and Admin UI (`7fb01f3`)
- **Storefront Availability Migration:**
  - `artifacts/api-server/src/routes/products.ts`: `POST /products/prices` and `GET /products/:id/related` query `product_variant_public_availability`, returning `{ price, stock: available, available, slug }`.
  - `artifacts/api-server/src/routes/categories.ts`: Category product listing enriches `stock` with available quantity.
  - `artifacts/api-server/src/routes/orders.ts`: Preliminary checkout stock check validates items against available quantity.
  - `ProductCard.tsx`: Out-of-stock badge, low-stock threshold, and quick add buttons bind to `availableStock`.
  - `ProductGrid.tsx`: Passes `availableStock` to cards.
  - `ProductDetail.tsx`: `inStock` boolean, stepper clamp, and CTA bind to available quantity.
  - `ProductPage.tsx`: Fetches public availability from `product_variant_public_availability`.
  - `QuickViewModal.tsx`: Fetches public availability and disables Add-to-Cart when available is 0.
  - `ProductsPage.tsx`: Availability filter `instock=true` queries `product_variant_public_availability`.
  - `HomePage.tsx`: Featured, on-sale, and deal-of-the-day grids display available stock.
  - `CheckoutPage.tsx`: Validates cart quantities against server available stock.
- **Admin Inventory Screen (`InventoryPage.tsx`):**
  - Displays **three distinct columns:** `On Hand (H)`, `Reserved (R)`, and `Available (A)`.
  - Displays operational warning badge when $H < R$ (`Deficit X`).
  - Added summary card `Promises Exceed Stock` tracking deficit counts.
- **StockCell Unambiguity (`StockCell.tsx`):**
  - Explicit UI label and button tooltip: *"Modifies physical on-hand (H) only — not reservations."*
- **Counter Deposit & Aged Lists:**
  - `CreateDepositModal.tsx`: Counter deposit creation screen usable in under 60 seconds (< 200 lines).
  - `AgedReservationsList.tsx`: Owner aged holds review with age threshold selector and release actions (< 200 lines).
  - `ReservationsPage.tsx`: Full counter deposit operations with one-click "Pay & Collect" and partial payment recording (< 200 lines).

### §12.6 & §12.7 — Invariants & Test Suite (`c763a3f`)
- Added architectural invariant `no-on-hand-reads-on-storefront` to `scripts/audit/check-invariants.mjs` verifying that public storefront paths read availability, never raw on-hand.
- Implemented comprehensive Vitest suite `artifacts/store/src/__tests__/m2c-reservations-suite.test.ts` covering all 7 scenarios from §12.6 (< 200 lines).

---

## 3. Disagreements with the Work Order & Resolutions

1. **Staff Payment vs. Price Authority:**
   - Spec §6 stated "editable by the owner only", while §9 stated "staff: record a payment".
   - **Resolution:** Staff at the counter must be able to record partial installment payments as customers pay down their balances. The boundary is strictly enforced: staff may increment `paid_amount` up to `agreed_price`, but staff can **never** change `agreed_price` or release a reservation (both return 403 Forbidden to staff).
2. **Abandoned Deposit Auditability:**
   - Spec §6 forbade a payments ledger, which created a risk of unverifiable cash accounting when deposits were released.
   - **Resolution:** Added mandatory `release_reason` column to `reservations`. Releasing an abandoned deposit requires the owner to state whether funds were refunded or forfeited, preserving cash-drawer integrity without adding full accounting overhead.
3. **Deadlock Guard in Order Decrement:**
   - Competing multi-item carts sorting items in arbitrary JavaScript order risked deadlocks on intersecting variant locks.
   - **Resolution:** `decrement_order_stock` sorts variant IDs in ascending order prior to row-level locking.

---

## 4. Test Tiers Run & Real Output

### Local Test Tiers Actually Executed
- **Full Typecheck:** Workspace-wide `tsc --build` and project-level typechecks.
- **Unit & Property Test Suites:** Vitest across `store-unit` and `env-validation` projects.
- **Strict Invariant Checks:** `scripts/audit/check-invariants.mjs --strict` with empty baseline across 13 mechanical checks.

*(Note: As documented in AGENTS.md, the `api-integration` tier requires running Supabase infrastructure and runs in CI, not in local checkouts.)*

### 1. `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
> tsc --build

Scope: 5 of 10 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 2. `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests)
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests)
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests)
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests)
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests)
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests)
 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests)
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests)
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests)
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests)
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests)
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests)
 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (4 tests)
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests)
 ✓  env-validation  tests/env-validation.test.ts (9 tests)
 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (24 tests)
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests)
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests)
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (19 tests)
 ✓  store-unit  src/__tests__/allow-negative-stock.test.ts (9 tests)
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests)
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests)
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests)
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests)
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests)
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests)
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests)
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (6 tests)
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests)
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (5 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-public-grant.test.ts (3 tests)
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests)
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests)
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests)
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-order.test.ts (3 tests)
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-suite.test.ts (7 tests)
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (5 tests)
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests)
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-effective-status.test.ts (2 tests)
 ✓  store-unit  src/__tests__/stocktake-mutation-guards.test.ts (7 tests)
 ✓  store-unit  src/__tests__/m2c-reservations-availability-view.test.ts (3 tests)
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests)
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests)
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests)
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests)
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests)
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (3 tests)
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests)
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests)
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests)
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests)
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests)

 Test Files  57 passed (57)
      Tests  665 passed (665)
   Start at  23:37:26
   Duration  5.08s
```

### 3. `pnpm run audit:invariants:strict`
```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
ok    on-hand-repair-setting-isolation 0 total, 0 new
ok    no-direct-variant-costs-writes   0 total, 0 new
ok    no-cost-column-on-staff-tables   0 total, 0 new
ok    no-private-columns-on-anon-grants 0 total, 0 new
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new

All invariant checks passed.
```
