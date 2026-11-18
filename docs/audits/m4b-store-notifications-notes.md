# M4b Store Notifications Build Round 1 Audit Notes

## Commit Log

1. **`721b22a feat(db): add admin_inbox_seen table migration and database types`**
   - Created migration `supabase/migrations/20261118130000_m4b_admin_inbox_seen.sql` defining `public.admin_inbox_seen` with RLS enabled, service-role policy, privileges revoked from `public, anon, authenticated`, and granted to `service_role`.
   - Updated `artifacts/supabase-types/src/database.types.ts` with `admin_inbox_seen` table types.
2. **`ab0992c feat(api): add inbox pure logic for role filtering and unread calculation`**
   - Created `artifacts/api-server/src/lib/inbox.ts` implementing `itemsForRole(role)` and `markUnread(events, marker, userId, now)` with role-based needs_you keys and 14-day cutoff logic.
3. **`89b299f feat(api): add admin inbox routes and route parity tests`**
   - Created `artifacts/api-server/src/routes/admin/inbox.ts` and `artifacts/api-server/src/lib/inbox-queries.ts` mounting `GET /admin/inbox/count`, `GET /admin/inbox`, and `POST /admin/inbox/seen` guarded by `requireStaffOrAdmin`. Added routes to `artifacts/api-server/tests/admin-routes.test.ts`.
4. **`956cba0 feat(store): rebuild notification center and add admin layout badge`**
   - Updated `AdminLayout.tsx` adding Notifications nav item with unread count badge in sidebar and mobile top bar header bell icon. Added auto-refresh on mount, route change, and window focus. Allowed staff access to `/admin/notifications` in `isStaffAllowedAdminPath`.
   - Rebuilt `pages/admin/NotificationCenterPage.tsx` decomposed into three modular components (`NeedsYouSection.tsx`, `HappenedSection.tsx`, `PlatformSection.tsx`). Added localized dictionary keys under `Notifications` and `Admin.Nav.notifications` in `az.ts`, `en.ts`, and `ru.ts` while preserving CRLF line endings.
5. **`24b6e6b feat(audit): add M4b architectural invariants for migrations and inbox grants`**
   - Added architectural invariant checks `m4b-no-functions-on-stock-or-sales` and `no-client-grants-on-admin-inbox-seen` in `scripts/audit/check-invariants.mjs`.
6. **`3c26628 test(inbox): add unit, integration, and e2e tests for admin inbox and staff access`**
   - Added unit test suite `artifacts/store/src/__tests__/m4b-inbox.unit.test.ts` testing `itemsForRole` and `markUnread`.
   - Added integration test suite `artifacts/api-server/tests/m4b-inbox.integration.test.ts` testing count drop on post, unread marking for non-actor admin, staff payload constraints, and shopper 403.
   - Added Playwright E2E test in `artifacts/store/tests/e2e/staff-access.spec.ts` verifying staff navigation to notifications and access to both linked destinations.

---

## Blocked / Assumptions / Not verified

1. **Blocked**:
   - None.
2. **Assumptions**:
   - "Not yet handled" online orders is predicate `orders.status = 'pending'` only.
   - Admin inbox events lookback window is fixed to 14 days, capped at 50 events per kind.
   - Low-stock signal count for both admin and staff is derived from existing `get_low_stock_signals(NULL, NULL)` RPC row count.
3. **Not verified**:
   - The integration test suite (`artifacts/api-server/tests/m4b-inbox.integration.test.ts`) and Playwright E2E suite were **NOT RUN** locally (CI only, as they require live Supabase credentials and running backend server).

---

## Tests Added, Moved, or Changed by Name

### Tests Added
- `artifacts/store/src/__tests__/m4b-inbox.unit.test.ts`:
  - `M4b inbox pure logic > itemsForRole > returns all 5 needs_you keys for admin`
  - `M4b inbox pure logic > itemsForRole > returns only low_stock and holds_overdue for staff`
  - `M4b inbox pure logic > itemsForRole > returns empty array for unknown or null roles`
  - `M4b inbox pure logic > markUnread > handles missing marker (defaults cutoff to now - 14 days)`
  - `M4b inbox pure logic > markUnread > handles marker older than the window`
  - `M4b inbox pure logic > markUnread > marks own actor as read even if newer than marker`
  - `M4b inbox pure logic > markUnread > counts NULL actor as someone else (unread if newer than marker)`
- `artifacts/api-server/tests/m4b-inbox.integration.test.ts`:
  - `M4b admin inbox integration > a held sale leaves the count when posted, with admin_inbox_seen unchanged`
  - `M4b admin inbox integration > a void is unread for another admin and not for voided_by`
  - `M4b admin inbox integration > a staff token gets the two counts, events: null, and no other key`
  - `M4b admin inbox integration > a shopper's token gets 403 on all three routes`
- `artifacts/store/tests/e2e/staff-access.spec.ts`:
  - `Staff Access Controls > shows Notifications entry in navigation and staff links resolve to pages staff can open`

### Tests Deleted, Renamed, or Weakened
- None.

---

## Command Outputs

### 1. `pnpm run audit:invariants:strict`

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
ok    m4b-no-functions-on-stock-or-sales 0 total, 0 new
ok    no-client-grants-on-admin-inbox-seen 0 total, 0 new

All invariant checks passed.
```

### 2. `pnpm run typecheck`

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
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 3. `pnpm test:unit`

```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\session-start-01ac49
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/session-start-01ac49

 Test Files  75 passed (75)
      Tests  786 passed (786)
```
