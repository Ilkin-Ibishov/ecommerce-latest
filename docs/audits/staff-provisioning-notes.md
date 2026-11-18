# Staff Provisioning Build Round 1 Audit Notes

## Commit Log

1. **`aaea24f feat(db): place audit_log table under version control`**
   - Created migration `supabase/migrations/20261118120000_audit_log_tracked.sql` placing `public.audit_log` under version control with required indexes (`actor_id`, `(entity, entity_id)`, `created_at DESC`) and row-level security enabled.
2. **`5a690a8 feat(db): enforce that at least one admin remains`**
   - Created migration `supabase/migrations/20261118120100_users_keep_one_admin.sql` defining trigger function `trg_users_keep_one_admin()` attached `BEFORE UPDATE OR DELETE ON public.users` to prevent demoting or deleting the final admin account with error `ST040`.
3. **`93e8e55 feat(db): add set_user_role and find_auth_user_by_phone functions`**
   - Created migration `supabase/migrations/20261118120200_set_user_role.sql` defining `set_user_role(p_actor uuid, p_user uuid, p_role text)` with atomic `audit_log` change tracking and `find_auth_user_by_phone(p_phone text)`. Updated TypeScript definitions in `artifacts/supabase-types/src/database.types.ts`.
4. **`51e84cd feat(api): export isBypassPhone helper`**
   - Exported `isBypassPhone(phone: string): boolean` helper in `artifacts/api-server/src/lib/otp.ts` testing normalized phone against `TEST_PHONES`.
5. **`99e7d1f feat(api): rewrite admin users routes with Zod validation, error codes, and set_user_role`**
   - Rewrote `artifacts/api-server/src/routes/admin/users.ts` with strict Zod validation schemas (`adminUsersQuerySchema`, `createStaffBodySchema`, `updateRoleBodySchema`), structured error codes (`invalid_search`, `invalid_phone`, `phone_reserved`, `phone_ambiguous`, `already_staff`, `auth_create_failed`, `cannot_demote_self`, `last_admin`, `not_found`), `set_user_role` RPC calls, and zero `as any`.
6. **`70caf43 feat(store): open admin shell to staff with role-based navigation and access guard`**
   - Updated `AdminLayout.tsx` to permit staff role (`role === "admin" || role === "staff"`). Added `adminOnly: true` flags to navigation entries whose endpoints call `requireAdmin`. Added staff redirect from `/admin` to `/admin/counter` and access denied fallback panel for forbidden routes. Added i18n keys for access denied across `az.ts`, `en.ts`, and `ru.ts`.
7. **`b18d0a0 feat(store): implement users admin page with role control and add staff modal`**
   - Implemented `UsersPage.tsx` (116 lines, strictly ≤ 150 lines), `UserRoleControl.tsx` (143 lines, strictly ≤ 200 lines) with self-demotion explanation, and `AddStaffModal.tsx` using platform dialog elements. Added i18n keys and error code mappings in `az.ts`, `en.ts`, and `ru.ts`.
8. **`68f9fa4 test(invariants): enforce role metadata read and user role write invariants`**
   - In `scripts/audit/check-invariants.mjs`, added architectural invariants `no-auth-metadata-role-reads` and `role-written-only-by-users-route`.
9. **`2708c86 test(api): add unit, serial integration, and e2e tests for staff provisioning`**
   - Added unit test suites `invariant-no-auth-metadata-role-reads.test.ts`, `require-staff-or-admin-role-source.test.ts`, `admin-staff-management.test.ts`, route inventory in `admin-routes.test.ts`, typed API unit test `admin-users.test.ts`, serial integration suite `staff-provisioning.test.ts`, and Playwright E2E spec `staff-access.spec.ts`.

---

## A1 Access Table

Every admin page, the API routes it interacts with, their server guard (`requireAdmin` vs `requireStaffOrAdmin`), and visibility to staff:

| Page | Routes Called | Route Guard | Visible to Staff? |
|---|---|---|:---:|
| **Counter** (`/admin/counter`) | `POST /admin/counter-sales`<br>`GET /admin/inventory/availability` | `requireStaffOrAdmin`<br>`requireStaffOrAdmin` | **YES** |
| **Inventory** (`/admin/inventory`) | `GET /admin/inventory`<br>`GET /admin/inventory/availability`<br>`POST /admin/inventory/adjust` | `requireStaffOrAdmin`<br>`requireStaffOrAdmin`<br>`requireStaffOrAdmin` | **YES** |
| **Reservations** (`/admin/reservations`) | `GET /admin/reservations`<br>`PATCH /admin/reservations/:id/cancel`<br>`POST /admin/reservations/:id/fulfill` | `requireStaffOrAdmin`<br>`requireStaffOrAdmin`<br>`requireStaffOrAdmin` | **YES** |
| **Stocktakes** (`/admin/stocktakes`) | `GET /admin/stocktakes`<br>`POST /admin/stocktakes`<br>`GET /admin/stocktakes/:id/lines`<br>`PATCH /admin/stocktakes/:id/lines`<br>`POST /admin/stocktakes/:id/post` | `requireStaffOrAdmin`<br>`requireStaffOrAdmin`<br>`requireStaffOrAdmin`<br>`requireStaffOrAdmin`<br>`requireStaffOrAdmin` | **YES** |
| **Dashboard** (`/admin`) | `GET /admin/dashboard/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Products** (`/admin/products`) | `POST /admin/products`<br>`PATCH /admin/products/*`<br>`DELETE /admin/products/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Orders** (`/admin/orders`) | `GET /admin/orders`<br>`PATCH /admin/orders/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Users** (`/admin/users`) | `GET /admin/users`<br>`POST /admin/users`<br>`PATCH /admin/users/:id/role` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Coupons** (`/admin/coupons`) | `GET /admin/coupons`<br>`POST /admin/coupons`<br>`PATCH /admin/coupons/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Categories** (`/admin/categories`) | `POST /admin/categories`<br>`PATCH /admin/categories/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Settings** (`/admin/settings`) | `GET /admin/settings`<br>`PATCH /admin/settings` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Audit Log** (`/admin/audit-log`) | `GET /admin/audit-log` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Bundles** (`/admin/bundles`) | `POST /admin/bundles`<br>`PATCH /admin/bundles/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Receipts** (`/admin/receipts`) | `POST /admin/receipts` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Suppliers** (`/admin/suppliers`) | `GET /admin/suppliers`<br>`POST /admin/suppliers` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **Comments** (`/admin/comments`) | `PATCH /admin/comments/*`<br>`DELETE /admin/comments/*` | `requireAdmin` | **NO** (`adminOnly: true`) |
| **WhatsApp** (`/admin/whatsapp`) | `GET /admin/whatsapp/status`<br>`POST /admin/whatsapp/test` | `requireAdmin` | **NO** (`adminOnly: true`) |

---

## Blocked / Assumptions / Not verified

1. **Assumptions**:
   - `artifacts/api-server/src/routes/bootstrap.ts` is exempted in invariant check `role-written-only-by-users-route` because it creates the first administrator during first-run setup when 0 admins exist (before any actor exists to invoke `set_user_role`). Prompt §8 noted `routes/auth.ts` no longer writes `role`; `bootstrap.ts` is the only other caller in the repo.
   - Remote Supabase project will receive and apply migrations `20261118120000_audit_log_tracked.sql`, `20261118120100_users_keep_one_admin.sql`, and `20261118120200_set_user_role.sql` in CI.
2. **Blocked**:
   - None.
3. **Not verified**:
   - The `api-integration`, `serial` integration, and Playwright `E2E` tiers were **NOT RUN** locally. They require live Supabase credentials and a running server, and run in CI (`.github/workflows/test.yml`).

---

## Tests Added, Moved, or Changed by Name

### Tests Added
- `artifacts/store/src/__tests__/invariant-no-auth-metadata-role-reads.test.ts`:
  - `no-auth-metadata-role-reads invariant > fails on user_metadata.role`
  - `no-auth-metadata-role-reads invariant > fails on user_metadata?.role`
  - `no-auth-metadata-role-reads invariant > fails on app_metadata.role`
  - `no-auth-metadata-role-reads invariant > fails on app_metadata?.role`
  - `no-auth-metadata-role-reads invariant > fails on user_metadata["role"]`
  - `no-auth-metadata-role-reads invariant > fails on app_metadata?.['role']`
  - `no-auth-metadata-role-reads invariant > passes when role comes from the profile and metadata is only written`
  - `no-auth-metadata-role-reads invariant > ignores files outside artifacts/api-server/src`
- `artifacts/store/src/__tests__/require-staff-or-admin-role-source.test.ts`:
  - `requireStaffOrAdmin role source > 403 when metadata says admin but there is no profile row`
  - `requireStaffOrAdmin role source > 403 when the profile row has a null role`
  - `requireStaffOrAdmin role source > passes when the profile row role is admin`
- `artifacts/store/src/__tests__/admin-staff-management.test.ts`:
  - `Staff Management Frontend Logic > Phone formatting and validation > normalizes Azerbaijan phone formats to +994XXXXXXXXX`
  - `Staff Management Frontend Logic > Phone formatting and validation > validates 9-digit Azerbaijan mobile numbers`
  - `Staff Management Frontend Logic > Role mapping and i18n consistency > has translation keys for all staff management strings across locales`
  - `Staff Management Frontend Logic > Role mapping and i18n consistency > supports admin, staff, and customer roles`
- `artifacts/api-server/tests/admin-users.test.ts`:
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies GET /admin/users for shopper`
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies POST /admin/users for shopper`
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies PATCH /admin/users/:id/role for shopper`
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies GET /admin/users for staff`
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies POST /admin/users for staff`
  - `Admin Users & Staff Management API > 403 Forbidden for non-admin tokens > denies PATCH /admin/users/:id/role for staff`
  - `Admin Users & Staff Management API > Bypass phone reservations > refuses POST /admin/users for bypass phone +994550000001`
  - `Admin Users & Staff Management API > Bypass phone reservations > refuses POST /admin/users for bypass phone +994550000002`
  - `Admin Users & Staff Management API > Bypass phone reservations > refuses POST /admin/users for bypass phone +994550000003`
  - `Admin Users & Staff Management API > Bypass phone reservations > refuses PATCH /admin/users/:id/role for target with bypass phone when new role is not customer`
  - `Admin Users & Staff Management API > Unknown ID handling > returns 404 for unknown user id and executes no audit line`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > creates a new staff user via auth.admin.createUser and set_user_role`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > promotes an existing customer to staff without re-creating auth user`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > refuses duplicate staff or admin creation with 409 already_staff`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > prevents self-demotion on PATCH /admin/users/:id/role`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > prevents demoting the last admin with 409 last_admin`
  - `Admin Users & Staff Management API > Staff provisioning and role updates > returns 200 without rpc call when setting the same role`
- `artifacts/api-server/tests/serial/staff-provisioning.test.ts`:
  - `Staff provisioning serial integration suite > provisions new phone as staff and records audit log`
  - `Staff provisioning serial integration suite > promotes customer to staff while keeping existing orders intact`
  - `Staff provisioning serial integration suite > refuses duplicate creation when same phone provided in alternate format`
  - `Staff provisioning serial integration suite > demoting the only admin is refused by the database trigger ST040 for service role`
  - `Staff provisioning serial integration suite > two concurrent cross-demotions via Promise.all leave at least one admin`
  - `Staff provisioning serial integration suite > demoted staff member's next admin request returns 403`
- `artifacts/store/tests/e2e/staff-access.spec.ts`:
  - `Staff Access Controls > /admin lands on the counter page`
  - `Staff Access Controls > shows counter and inventory entries in sidebar`
  - `Staff Access Controls > does not show Users, Orders, or Settings in navigation`
  - `Staff Access Controls > shows access denied panel when navigating directly to admin-only pages`

### Tests Changed
- `artifacts/api-server/tests/admin-routes.test.ts`:
  - Added `"POST /admin/users"` to `EXPECTED_ROUTES` array under `users.ts`.

### Tests Deleted, Renamed, or Weakened
- None.

---

## Verbatim Command Output

### 1. `pnpm run typecheck`

```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\session-start-01ac49
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\session-start-01ac49
> tsc --build

Scope: 5 of 11 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 2. `pnpm run audit:invariants:strict`

```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\session-start-01ac49
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
ok    no-client-insert-policy-on-stock-movements 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new
ok    no-non-tracked-variant-movements 0 total, 0 new
ok    signals-have-one-derivation      0 total, 0 new
ok    no-undispatched-notification-type 0 total, 0 new
ok    i18n-keys-exist-in-dictionaries  0 total, 0 new
ok    no-auth-metadata-role-reads      0 total, 0 new
ok    role-written-only-by-users-route 0 total, 0 new

All invariant checks passed.
```

### 3. `pnpm test:unit`

```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\session-start-01ac49
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/session-start-01ac49

 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 98ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 336ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 488ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 422ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 192ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 1501ms
   ✓ Feature: order-tracking-timeline, Property 5: All order items are displayed with required fields > all items have title, quantity, and correctly computed line_total, and row count equals array length  678ms
   ✓ Feature: order-tracking-timeline, Property 7: Date formatting respects active locale > formatted date uses correct locale identifier for any timestamp and locale  546ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 2540ms
   ✓ security-definer-service-role-privileges > fails when only public is revoked (anon/authenticated keep Supabase's default grant)  535ms
   ✓ security-definer-service-role-privileges > fails when a client role is granted explicitly  459ms
   ✓ security-definer-service-role-privileges > passes when a later migration closes the grant  561ms
   ✓ no-client-insert-policy-on-stock-movements > fails while a client INSERT policy is live  512ms
   ✓ no-client-insert-policy-on-stock-movements > passes once a later migration drops it  470ms
 ✓ |store-unit| src/__tests__/invariant-i18n-keys.test.ts (5 tests) 2539ms
   ✓ i18n-keys-exist-in-dictionaries > fails on a t() key that no dictionary defines  443ms
   ✓ i18n-keys-exist-in-dictionaries > fails on a labelKey that no dictionary defines  550ms
   ✓ i18n-keys-exist-in-dictionaries > passes once the key is added  505ms
   ✓ i18n-keys-exist-in-dictionaries > ignores a bare, undotted t() argument  550ms
   ✓ i18n-keys-exist-in-dictionaries > reports the parser, not the dictionary, when the dictionary cannot be parsed  487ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 1720ms
   ✓ Feature: white-label-customization, Property 17: Page translation locale fallback > falls back to az locale when active locale translation does not exist but az does  402ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 3421ms
   ✓ signals-have-one-derivation invariant > fails when a duplicate signals file exists in lib/  515ms
   ✓ signals-have-one-derivation invariant > fails when inventory-signals.ts has an empty catch block  397ms
   ✓ signals-have-one-derivation invariant > passes when routes handle errors without empty catch and no lib duplicate exists  622ms
   ✓ no-undispatched-notification-type invariant > fails when NotifType contains an unhandled type  493ms
   ✓ no-undispatched-notification-type invariant > passes when all NotifType members have dispatch branches  458ms
   ✓ no-non-tracked-variant-movements invariant > fails when M4 void_counter_sale does not filter track_stock = true  480ms
   ✓ no-non-tracked-variant-movements invariant > passes when M4 migrations properly guard and filter track_stock  451ms
 ✓ |store-unit| src/__tests__/invariant-no-auth-metadata-role-reads.test.ts (8 tests) 3419ms
   ✓ no-auth-metadata-role-reads invariant > fails on user_metadata.role  342ms
   ✓ no-auth-metadata-role-reads invariant > fails on user_metadata?.role  456ms
   ✓ no-auth-metadata-role-reads invariant > fails on app_metadata.role  582ms
   ✓ no-auth-metadata-role-reads invariant > fails on app_metadata?.role  386ms
   ✓ no-auth-metadata-role-reads invariant > fails on user_metadata["role"]  457ms
   ✓ no-auth-metadata-role-reads invariant > fails on app_metadata?.['role']  401ms
   ✓ no-auth-metadata-role-reads invariant > passes when role comes from the profile and metadata is only written  343ms
   ✓ no-auth-metadata-role-reads invariant > ignores files outside artifacts/api-server/src  449ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 80ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 543ms
   ✓ Property: Price validation rejects all non-positive numbers > NaN-producing strings are always rejected  320ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 4701ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when a migration grants client INSERT on counter_sale_payments  536ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when a migration grants client ALL on counter_sale_payments  537ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT ALL ON ALL TABLES IN SCHEMA public is given to authenticated  551ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT INSERT lists multiple tables including counter_sale_payments  468ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when an unquoted policy grants client INSERT on counter_sale_payments  477ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT INSERT uses quoted identifiers for schema and table  450ms
   ✓ no-client-writes-on-counter-sale-payments invariant > passes when only SELECT is granted to client and writes are denied  404ms
   ✓ post-counter-sale-writes-payments invariant > fails when the last migration defining post_counter_sale omits payment insert  512ms
   ✓ post-counter-sale-writes-payments invariant > passes when the last migration defining post_counter_sale inserts into counter_sale_payments  685ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 79ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 440ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 94ms
 ✓ |store-unit| src/__tests__/require-staff-or-admin-role-source.test.ts (3 tests) 44ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 103ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 99ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 1406ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > footer navigation includes exactly published pages with show_in_footer=true, sorted by sort_order ascending  415ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > unpublished pages are never included regardless of nav flags  397ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 86ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 72ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 40ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 152ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 406ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 18ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 40ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 29ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 31ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 283ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 40ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 32ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 6923ms
   ✓ Property 5: Breadcrumb path resolution produces valid ancestor chain > resolved path starts from root ancestor and ends at target category  398ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  3749ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants but null selectedIndex, addItem uses default product data  308ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 47ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 34ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 26ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 26ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 15ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 28ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 29ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 24ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (5 tests) 15ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 19ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 17ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 21ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 22ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 21ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 21ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 17ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 18ms
 ✓ |store-unit| src/__tests__/signal-settings.test.ts (4 tests) 35ms
 ✓ |store-unit| src/__tests__/counter-input.test.ts (8 tests) 19ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 16ms
 ✓ |store-unit| src/__tests__/admin-staff-management.test.ts (4 tests) 23ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 24ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 22ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 20ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 44ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 42ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 18ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 13ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 18ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 24ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 15ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 17ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 13ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 16ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 146ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 106ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 178ms

 Test Files  73 passed (73)
      Tests  774 passed (774)
   Start at  19:23:44
   Duration  28.03s (transform 18.28s, setup 0ms, collect 57.68s, tests 37.15s, environment 20.32s, prepare 85.04s)
```

---

## Architect acceptance — 2026-11-18 (checked against the diff, not these notes)

- Files: as the prompt named, plus `docs/audits/INDEX.md` and `prompts/INDEX.md` (regenerated).
- Tests removed: 0 (`git diff origin/main...HEAD -- '*.test.ts' '*.spec.ts' | grep -c '^-.*\bit('`).
- **Fixed by the architect (commit after this round):**
  1. Two new `as any` in the screen (`AddStaffModal.tsx:53`, `UsersPage.tsx:63`), casting a
     runtime-built key into `t()`. Replaced by `components/admin/user-error-key.ts`: a code→key map
     typed `MessageKey` (not `TranslationKey`, which admits any string), so a missing dictionary key
     fails typecheck. An unknown code falls back to `Admin.Common.error`.
  2. `POST /admin/users` fallback path upserted the profile `ON CONFLICT (id)` with
     `full_name: null`, wiping an existing customer's name. Now `ignoreDuplicates: true`
     (`DO NOTHING`, note §3).
- Accepted: the `bootstrap.ts` exemption in `role-written-only-by-users-route` (first-run endpoint,
  refuses once an admin exists). Two new test files over 200 lines (`tests/admin-users.test.ts`
  401, `tests/serial/staff-provisioning.test.ts` 250): test tables, accepted.
- Correction to *Assumptions* above: CI does **not** apply migrations. The architect applies them
  to the test project (owner's yes, 2026-11-18).
- Minor, not changed: `PATCH /admin/users/:id/role` answers a malformed body with `not_found`.
- Local, on this branch after the fixes: `pnpm run typecheck` (api-server, store: Done),
  `pnpm run audit:invariants:strict` ("All invariant checks passed."), `pnpm test:unit`
  ("Test Files 73 passed (73)", "Tests 774 passed (774)"). Integration, serial and E2E: CI only.
- **Applied to the test project** (`jcvsnoiacrknzejouxah`, 2026-11-18, `apply_migration`, owner's
  yes): `20261118120000_audit_log_tracked`, `20261118120100_users_keep_one_admin`,
  `20261118120200_set_user_role`. The second was applied without its `DROP TRIGGER IF EXISTS` line
  (an automatic check declined the statement; the trigger did not exist, so the line was a no-op).
  Verified read-only afterwards: trigger present, three functions present, `EXECUTE` on
  `set_user_role` / `find_auth_user_by_phone` held by `service_role` only (`anon` and
  `authenticated`: false). A rolled-back behavioural dry-run was declined by the same check and
  not run; the serial integration tests in CI cover it.
- **CI round 1 failed 2 mocked tests in `tests/admin-users.test.ts`** (run 44338832690): the mock
  client had `insert().select().single()` while the route calls `upsert(..., { ignoreDuplicates })`,
  and the acting admin's id was the string `"admin-actor-id"`, which the route rejects as a malformed
  uuid before the self-demotion check. Both were fixture errors; fixed (`ACTOR_ID` is a real uuid,
  the mock gains an insert-if-absent `upsert`). No assertion changed. Run locally with dummy env:
  "Test Files 1 passed (1)", "Tests 17 passed (17)".
- **CI round 2: `tests/serial/staff-provisioning.test.ts` failed 4 of 6** (run 44339729160) and two
  of its passes were vacuous. Causes: `users` rows inserted with random ids violate
  `users.id → auth.users` (23503, then ST041 / a 0-row count downstream); the order insert used a
  non-existent `total_amount` (PGRST204); with 55 admins on the test project the "only admin" and
  "concurrent demotion" tests never reached the guard. **Rewritten by the architect, same six test
  names:** users created through `auth.admin.createUser`; the order uses `subtotal_azn`/`total_azn`;
  promotion and the format duplicate go through `POST /admin/users` as the bypass admin
  (409 `already_staff` for the `0…` form); the guard is hit by one service-role `UPDATE` demoting
  every admin (ST040, nothing changes) and by two concurrent halves (exactly one ST040), with an
  `afterAll` that restores any admin changed; the demotion test signs the staff member in and sees
  200 then 403 on `GET /admin/counter/bundles`. Not run locally (needs the test project).
- **CI round 3: E2E `staff-access.spec.ts` failed 2 of 4** (run 44340668579). The failure
  screenshots showed the feature working: the panel reads "This section is for administrators only",
  which the test's `/access denied|…/` never matched; the other failure was a staff sign-in that
  had not completed, because every test signed the same phone in again across parallel workers.
  Fixed the test the way admin E2E was fixed in #19: `auth.setup.ts` saves a staff session once
  (`STAFF_STATE`, `loginAsStaff` in `tests/helpers/admin-auth.ts`) and the spec reuses it. Also the
  "no Users entry" check looked for "Users" while the entry is labelled "Customers" — it now
  matches `/customers|users/i`. No assertion weakened.

---

## Adversarial audit after merge — 2026-11-18 (clean-context auditor: spec + diff + invariants)

Seven findings; resolution of each, checked against the code by the architect:

| # | Finding | Resolution |
|---|---|---|
| 1 major | E2E sessions use test phones holding `admin`/`staff` on the test project | **Accepted.** Owner's decision 2026-11-18: the bypass stays in the test environment; the production gate is in `docs/knowledgebase/supabase-projects.md` |
| 2 major | `POST /admin/users` auth-fallback path re-roled an existing staff/admin whose profile phone the lookup missed (no 409) | **Fixed:** the fallback reads the found profile's role and answers 409 `already_staff`; mocked test `refuses to re-role an admin found only through the auth fallback` |
| 3 minor | Self-demotion check bypassed with the caller's uuid in upper case | **Fixed:** case-insensitive compare; mocked test `refuses self-demotion when the caller id is sent in upper case` |
| 4 minor | `bootstrap.ts` wrote `role` directly, no test-phone refusal, no audit line; invariant exempted it | **Fixed:** canonical phone + `validateAzPhone`, `phone_reserved` for test phones, `find_auth_user_by_phone` instead of `listUsers`, role via `set_user_role` (actor = the new admin). The invariant no longer exempts the file; bootstrap is allow-listed only as a second caller of `set_user_role` |
| 5 minor | Guard beatable by two `REPEATABLE READ` writers | **Fixed:** migration `20261118150000_users_keep_one_admin_hardening.sql` refuses admin demotion/deletion outside READ COMMITTED (`ST042`). (Locking admin rows instead would deadlock against the advisory lock under concurrent demotions.) Applied to the test project 2026-11-18 |
| 6 minor | `TRUNCATE public.users` bypasses the row trigger | **Fixed:** same migration, `BEFORE TRUNCATE` statement trigger raising `ST040` |
| 7 minor | New-phone route path untested against the database; the auth trigger leaves the profile with the digits-only phone, so the new staff member's first sign-in depended on the 1000-user `listUsers` scan | **Fixed:** the route now writes the canonical phone (and name) onto the trigger-created profile; serial test `a new phone added through the route is stored canonically and can sign in as staff` |

Also noted by the auditor, outside this phase: `StocktakeCountPage` reads `res.matches` while
`/inventory/scan` returns an array — counting by scan cannot find items. Recorded in STATUS.
Mocked route tests locally (dummy env): "Tests 19 passed (19)". Serial tier: CI.
