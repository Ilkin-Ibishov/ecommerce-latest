# M4b — Notifications: the admin's inbox — build round 1

Read `AGENTS.md`, `artifacts/api-server/AGENTS.md`, `artifacts/store/AGENTS.md`, `supabase/AGENTS.md`,
the spec `docs/tasks/m4b-store-notifications.md` and the approved design note
`docs/design-notes/m4b-store-notifications.md`, **including its §12 review**. The note is approved
as written; build exactly it.

Branch `phase/m4b-store-notifications`; it is checked out. Never commit to `main`. Commit locally;
do not push. **Do not touch any Supabase project and do not run SQL** — the architect applies the
migration. **Do not edit any existing file under `supabase/migrations/`.**

Staff provisioning has merged: the admin shell now admits `staff`, the sidebar is filtered by
`adminOnly` in `artifacts/store/src/pages/admin/AdminLayout.tsx`, and staff see counter, inventory,
reservations and stocktakes. Build on that; do not change the shell's sign-in gate or any
`adminOnly` flag.

**Columns already confirmed on the test project by the architect (2026-11-18)** — the note's §10
check is done; do not query the database: `orders.status` (enum `order_status`), `orders.created_at`,
`orders.customer_name`, `comments.approved`, `reservations.expires_at` (nullable),
`reservations.status`, `users.full_name` (nullable), `stocktakes.posted_at`/`posted_by` (nullable),
`stocktakes.status`/`title`/`stocktake_number`, `counter_sales.sale_number`/`status`/`posting_date`/
`cashier_id`/`total_mismatch`/`voided_by`/`voided_at`/`void_reason`, `counter_sale_lines.sale_id`/
`price_mismatch`/`reservation_override`.

If an instruction turns out wrong against the code, **stop on that item**, record it under
*Blocked* in the notes file, and go on. Never invent a column, route, key or setting.

One commit per numbered item, message `<type>(<scope>): <what changed>`.

## 1. Migration: the marker
`supabase/migrations/20261118130000_m4b_admin_inbox_seen.sql` — exactly the note's §4 SQL
(`admin_inbox_seen`, RLS on, service-role policy, `REVOKE ALL … FROM public, anon, authenticated`,
`GRANT ALL … TO service_role`). Add the table to `artifacts/supabase-types/src/database.types.ts`
under `public.Tables`, in the generator's format.

## 2. Pure logic
`artifacts/api-server/src/lib/inbox.ts`: `itemsForRole(role)` (staff: `low_stock`,
`holds_overdue`; admin: all five of the note's §3 *needs you* items) and
`markUnread(events, marker, userId)` per the note's §4–§5 (unread when `time > marker` and the actor
is not the session user; NULL actor counts as someone else; no marker → `now − 14 days`).

## 3. Routes
`artifacts/api-server/src/routes/admin/inbox.ts`, mounted in `routes/admin/index.ts` beside
`inventory-signals`: `GET /admin/inbox/count`, `GET /admin/inbox`, `POST /admin/inbox/seen`, all
`requireStaffOrAdmin`, exactly as the note's §5 table. Counts with `select("id", { count: "exact",
head: true })`; low stock through the existing `get_low_stock_signals(NULL, NULL)` RPC (its row count,
as `inventory-signals.ts` reads it). Events (admin only): the four kinds of §3, last 14 days, ≤ 50
per kind, no amount, total, cost or quantity selected. The staff path issues **no** event query
(`events: null`). Zod output schemas with `safeParse`, 500 on failure, as `inventory-signals.ts:81-89`
does. Add the three routes to the route inventory in `artifacts/api-server/tests/admin-routes.test.ts`.

## 4. Screen
- `AdminLayout.tsx`: one `navItems` entry `{ href: "/admin/notifications", labelKey: "Admin.Nav.notifications", … }`
  visible to staff and admin, with the count badge (none at zero), and the same badge on a bell button
  in the existing mobile top bar. Refresh on mount, route change and window focus (note §6). New key
  `Admin.Nav.notifications` in az, ru, en.
- `pages/admin/NotificationCenterPage.tsx` rebuilt: *Needs you* (links), *Happened* (unread marked;
  one "Mark all as seen" button; admin only), then the existing platform section unchanged in
  behaviour; if that request fails, omit it. New keys under the existing `Notifications` namespace.
  If the page would exceed 200 lines, split the three sections into three components.
- Preserve each dictionary file's existing line endings (they mix CRLF/LF); `git diff --stat` must
  show only your lines.

## 5. Invariants
`scripts/audit/check-invariants.mjs`, the note's §11.4: (a) no migration named `*_m4b_*` contains
`FUNCTION` together with `stock_movements`, `counter_sales` or `counter_sale_payments`; (b) no
`GRANT … TO anon` or `TO authenticated` on `admin_inbox_seen`.

## 6. Tests
- Offline (store-unit if it can import `lib/inbox.ts`, otherwise state why): `itemsForRole` per
  role; `markUnread` with marker missing, marker older than the window, own actor, NULL actor.
- Integration (`artifacts/api-server/tests/`, you cannot run it): a held sale leaves the count when
  posted, with `admin_inbox_seen` unchanged; a void is unread for another admin and not for
  `voided_by`; a staff token gets the two counts, `events: null`, and no other key; a shopper's
  token gets 403 on all three routes. Read your own rows with server-side filters, never by
  scanning an unfiltered list (the test project exceeds 1000 rows).
- E2E: the staff session from `artifacts/store/tests/e2e/staff-access.spec.ts` sees the
  Notifications entry and both staff links resolve to pages staff can open.
- Never delete, rename or `.skip()` a test.

## Definition of done
- `pnpm run typecheck`, `pnpm run audit:invariants:strict`, `pnpm test:unit` pass.
- `docs/audits/m4b-store-notifications-notes.md`: what each commit changed; **Blocked /
  Assumptions / Not verified**; every test added or changed by name; the **real output** of the three
  commands, pasted.
- State plainly that integration and E2E were **not run** (CI only). Do not claim they passed.
