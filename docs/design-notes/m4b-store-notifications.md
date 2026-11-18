# M4b design note — Notifications: the admin's inbox

> **Spec:** `docs/tasks/m4b-store-notifications.md`
> **Written by:** the architect (main session), 2026-11-16, against `main` at `711781c`.
> **Status:** approved (review 2026-11-18, §12). Implement after staff provisioning.

Every name below was read in the file cited. Nothing was checked against a running database:
`orders`, `comments` and `notifications` exist only in `supabase/schema.sql`, not in any migration
(see *Not verified*).

## 1. The shape in one paragraph

One new table holding one timestamp per admin user ("seen up to"), one new route file with three
admin routes, one sidebar entry with a badge, and the existing `/admin/notifications` page rebuilt as
three sections. No new SQL function, no trigger, no event table, no change to any money or stock
function. "Needs you" items are `count` queries run at request time; "Happened" items are rows read
from their own tables for the last 14 days and marked unread in the API by comparing their timestamp
with the user's marker and their actor with the session user.

## 2. Where this note deviates from the spec, and why

| # | Spec says | This note proposes | Why |
|---|---|---|---|
| D1 | "Customer messages that failed to send" is a *needs you* item (§4) | **Dropped** | There is no screen where it can be handled. The only UI is the log on the order page, and its route reads a table that does not exist: `routes/admin/orders.ts:123-125` reads `notification_queue` by `order_id`; the table is `notifications` (`schema.sql:815`) and has no `order_id`. The route catches the error and returns `[]`. A count that links nowhere is the "message nobody reads" §1 warns about. Re-open when that route is fixed (separate defect, §9). |
| D2 | "Goods receipt reversed" is a *happened* item (§4) | **Dropped** | `reverse_goods_receipt` writes only `status = 'reversed', updated_at = now()` (`20261104110000_m2a_functions_triggers.sql:719-724`); `goods_receipts` has no `reversed_by` / `reversed_at` (`20261104100000_m2a_schema_tables.sql:50-63`). Reversal is `requireAdmin` (`routes/admin/receipts.ts:281`). With no actor the line would be unread for the owner who did it — in a one-owner shop, every time. Deriving the actor from `audit_log` is out: that table has no tracked DDL. Storing an actor would change a stock function, which §3 forbids. |
| D3 | "A bell in the admin header" (§2, §8) | A **sidebar entry with a count badge**, plus a bell button in the existing mobile top bar | There is no desktop header: `AdminLayout.tsx:249` is `<header className="md:hidden …">`. Navigation is the sidebar list `navItems` (`AdminLayout.tsx:26-44`). Adding a desktop header for one icon is a layout change nobody asked for. |
| D4 | Platform announcements keep their unread count inside the one badge (§5, §9.5) | The section is shown; **its count is not added to the badge** | The existing chain does not work end to end, from code alone: the proxy calls `${PLATFORM_CONTROL_PLANE_URL}/api/store-feed` (`notifications-proxy.ts:27`) while the feed route is `/platform/store-feed/notifications` and needs an `x-store-id` header (`store-feed.ts:57-64,122`); the page posts mark-read to `/platform/notifications/:id/read` (`NotificationCenterPage.tsx:72`), a route that does not exist; the page reads `is_read`, the feed filters on `read` (`feed.ts:98`). Its read state is also per store, not per user (`003_notifications.sql:35-40`), against §5. Adding a number that cannot be cleared to the badge would make the badge permanently wrong. Fixing the chain is a separate task (§9). |
| D5 | Staff see "3 online orders to handle" (§7) | Staff get **low stock** and **holds past their date** only | §6's own rule: only items whose target screen staff can open. Orders and reviews are `requireAdmin` on every route (`routes/admin/orders.ts:16,48,108,118`; `routes/admin/comments.ts:7,15`). Held counter sales are resolved by the owner. Reservations and the signal routes are `requireStaffOrAdmin` (`routes/admin/reservations.ts:46,96`; `inventory-signals.ts:92,130`). |

One more fact the spec did not have: **staff cannot enter the admin UI today.**
`AdminLayout.tsx:105-107` sets `authed` only when `role === "admin"`. The staff filter in this phase
is therefore built and tested in the API; no staff user will see the page until staff provisioning
(`docs/tasks/staff-provisioning.md`) lands. This phase does not change `AdminLayout`'s sign-in gate.

## 3. §9.1 — every item, its source and predicate

**Needs you** (a count and a link; no read state)

| Item | Predicate | Link | Roles |
|---|---|---|---|
| Counter sales waiting for the owner | `counter_sales.status = 'needs_owner'` (`20261111120300_m3_counter_sales.sql:23`; partial index `idx_counter_sales_needs_owner` `:38`) | `/admin/counter/sales` | admin |
| Online orders not yet handled | `orders.status = 'pending'` (`schema.sql:738`; enum `order_status` `schema.sql:12-20`) | `/admin/orders` | admin |
| Variants running low | number of rows of `get_low_stock_signals(NULL, NULL)` (`20261113231500_m4_stock_signals_rpcs.sql:15`). Same number as the dashboard card (`inventory-signals.ts:122`): variants, `out` and `low` together, tracked only | `/admin/inventory?filter=low_stock` | admin, staff |
| Holds past their date | `reservations.status = 'active' AND expires_at < now()` (`schema.sql:1143,1147`). A NULL `expires_at` never qualifies | `/admin/reservations` | admin, staff |
| Reviews waiting for approval | `comments.approved = false` (`schema.sql:797`) | `/admin/comments` | admin |

`orders.status = 'pending'` only: `phone_verified` and later are states the owner has already acted on
(the status list the admin can set is at `routes/admin/orders.ts:11`). Assumption — see §10.

"Holds past their date" uses the spec's definition, not the wider one of
`GET /admin/reservations/aged` (`reservations.ts:96-137`), which also returns active holds older than
7 days with no date. A hold with no date is not late.

**Happened** (admin only; rows from the last 14 days, newest first, at most 50 per type)

| Item | Rows | Time | Actor | Shown |
|---|---|---|---|---|
| New online order | `orders` | `created_at` (`schema.sql:747`) | none — the shopper | order id (short), customer name |
| Counter sale voided | `counter_sales` where `status = 'voided'` | `voided_at` | `voided_by` (`…120300:27-29`; both NOT NULL when voided, constraint `chk_counter_void_attribution`) | sale number, `void_reason`, actor's name |
| Sale off list price or over a hold | `counter_sales` where `total_mismatch` is true, or a line has `price_mismatch` or `reservation_override` (`…120300:19,50-51`) | `posting_date` | `cashier_id` (NOT NULL) | sale number, which of the three flags, cashier's name |
| Stocktake posted | `stocktakes` where `status = 'posted'` | `posted_at` | `posted_by` (`20261104130000_m2b_stocktake_tables.sql:24-25`) | stocktake number, title, actor's name |

No amount, total, cost or quantity is selected for any event. `posted_after_count`
(`…120300:52`) is not on the spec's list and is not added.

## 4. §9.2 — the marker

New migration, one concern: `supabase/migrations/<timestamp after 20261116100100>_m4b_admin_inbox_seen.sql`.

```sql
CREATE TABLE public.admin_inbox_seen (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL
);
ALTER TABLE public.admin_inbox_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AdminInboxSeen: service role" ON public.admin_inbox_seen
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.admin_inbox_seen FROM public, anon, authenticated;
GRANT ALL ON public.admin_inbox_seen TO service_role;
```

The name avoids `notifications`, which keeps its one meaning (spec §5). No tenant column: each shop
has its own database; no table in `supabase/migrations` or `schema.sql` has one. Grants follow
`20261113230200_counter_sale_payments.sql:14-21`, minus the `authenticated` read: nothing here is
readable by a shopper's token.

A user with no row: the marker is treated as `now() - 14 days`, so a new admin sees the window's
events as unread once. "Mark all as seen" upserts `seen_at = now()` for the session user. An event is
**unread** when `time > marker` and the actor is not the session user.

## 5. §9.3, §9.4 — the read path

New file `artifacts/api-server/src/routes/admin/inbox.ts`, mounted in `routes/admin/index.ts` beside
`inventory-signals`. Service-role client; three routes, all `requireStaffOrAdmin`:

| Route | Returns |
|---|---|
| `GET /admin/inbox/count` | `{ count }` — sum of the role's *needs you* counts, plus unread events for admin |
| `GET /admin/inbox` | `{ needs_you: [{ key, count }], events: [...] \| null, seen_at }` — `events` is `null` for staff |
| `POST /admin/inbox/seen` | upserts the marker; `204` |

The path is `/admin/inbox`, not `/admin/notifications`: `POST /admin/notifications/:id/retry` already
exists for the WhatsApp log (`routes/admin/whatsapp.ts:24`).

**Several small queries, not one RPC.** Each count is `select("id", { count: "exact", head: true })`
with its predicate; the low-stock count calls the existing RPC. Staff safety is by construction: the
handler builds the list of queries from the role first, and the staff list contains two counts and
nothing else — no event query is issued, so no event or money column can reach a staff response. A
new `SECURITY DEFINER` function would add a grant surface for no gain at this size.

Pure logic lives in `artifacts/api-server/src/lib/inbox.ts`: `itemsForRole(role)` and
`markUnread(events, marker, userId)`. Zod schemas for both responses in the route file, `safeParse`,
500 on failure, as `inventory-signals.ts:81-89` does.

**Own actions (§9.4).** Void: `voided_by`. Mismatch sale: `cashier_id`. Stocktake: `posted_by`. Online
order: no staff actor, so it is unread for every admin. A NULL actor (possible only for
`stocktakes.posted_by`, which is nullable) counts as someone else. Actor names come from one
`users` lookup by id (`full_name`), not a join per query.

## 6. §9.6 — what the badge costs

Admin: 5 counts (one is an RPC) + 3 event queries (the mismatch one filters sales by a flag on lines:
two queries) + 1 marker read ≈ **11 small queries** per `GET /admin/inbox/count`. Staff: 2. The
client calls it when `AdminLayout` mounts, on route change and on window focus (spec §5), with no
cache. At hundreds of SKUs and tens of sales a day each query touches tens of rows; `needs_owner` has
its partial index. No index is added. If this is ever slow, the first step is dropping the
route-change refresh, not caching.

## 7. Where it appears

- `AdminLayout.tsx`: one `navItems` entry `{ href: "/admin/notifications", labelKey: "Admin.Nav.notifications", … }`
  with the count as a badge (no badge at zero), and a bell button with the same badge in the mobile
  top bar (`:249-259`). `Admin.Nav.notifications` is a new key.
- `pages/admin/NotificationCenterPage.tsx` is rebuilt: *Needs you* (links), *Happened* (unread lines
  marked; one "Mark all as seen" button), then the existing platform section unchanged in behaviour.
  If that request fails, the section is omitted; the other two do not depend on it.
- New keys under the existing `Notifications` namespace in `az.ts`, `ru.ts`, `en.ts`. The API returns
  keys and values (`key: "orders_pending"`, `count: 3`), never sentences.
- `modern-web-guidance` `search` before the UI code (`.agents/rules/frontend.md`).

## 8. Every rule: ordinary flow and intersections (spec §7)

| Rule | Ordinary flow | Intersection, and the answer |
|---|---|---|
| States are live counts | Morning: "2 sales need you, 5 low". The owner posts both; the next count is 3 lower with no write to `admin_inbox_seen` | `post_pending_counter_sale` sets `status = 'posted'` (`20261113231100…:69`): the row leaves the predicate. A threshold change moves the low count on the next read. Voiding a held sale also removes it |
| Events unread until seen | Staff voids at 14:00; the owner's badge is +1 until they press "Mark all as seen" | The void also removes the sale from the mismatch list? No — a voided sale that had a mismatch appears in both lists; two lines, both true |
| Own actions are not unread | The owner voids a sale; their badge does not change | A second admin sees it as unread. `stocktakes.posted_by` NULL: unread for everyone |
| Fixed look-back | Back after two weeks: 14 days of events | No marker row: marker = now − 14 days. A marker older than 14 days is the same thing, because nothing older is read |
| Staff see states only | Staff response: two counts, `events: null` | Blind counting (M2b): the low-stock item is a count and a link; no `on_hand`, no stocktake line. Staff cannot reach the page until staff provisioning (§2) |
| Low stock is a count | "5 variants low" → `/admin/inventory?filter=low_stock` | Non-tracked variants are excluded inside the RPC (`…231500`, `WHERE pv.track_stock = true`). The count is variants; the inventory page lists products — the two numbers can differ, as they already do between the dashboard and that page |
| Mark all as seen | One press, one upsert | An event that arrives between page load and the press is marked seen without having been shown. Accepted: the page is re-read after the press and still lists it, just not as unread |

## 9. Defects found on `main`, not fixed by this phase

1. `GET /admin/orders/:id/notifications` reads `notification_queue`, which does not exist (D1). The
   order page's WhatsApp log is always empty.
2. The platform-announcement chain is broken in four places (D4), and `GET /platform/notifications`
   is `requireUser` (`notifications-proxy.ts:19`): any signed-in shopper's token passes.
3. `OrderDetailPage.tsx:39` maps a `low_stock` notification type that `NotifType`
   (`lib/notifications.ts:7-9`) does not have.
4. `artifacts/store/src/__tests__/m4-stock-signals.unit.test.ts:67-92,219-256` tests a low-stock
   digest function defined inside the test file; no such production code exists since review D1.
   Not deleted (house rule); the owner or architect decides.

## 10. Blocked / Assumptions / Not verified

- **Not verified against a database.** `orders`, `comments`, `notifications` are defined only in
  `supabase/schema.sql`; the handoff of 2026-11-16 records that the test project's `orders` differs
  from tracked SQL (`subtotal_azn`). The builder must confirm `orders.status`, `orders.created_at`,
  `orders.customer_name`, `comments.approved`, `reservations.expires_at` and `users.full_name` on the
  test project before writing a query, and stop if one is missing.
- **Assumption:** "not yet handled" is `orders.status = 'pending'` only (spec §14 left this open).
- **Assumption:** every existing admin user is a row in `public.users` with `role = 'admin'`; the
  marker's foreign key relies on it.
- **Not verified:** that the platform proxy is unreachable in production — D4 is read from code.
- **Customer questions (spec §10)** were not asked. Defaults ship: staff see what they can act on;
  14 days; everything in §3 on; nothing leaves the app.
- **Blocked:** nothing.

## 11. Deliverables and sizes

1. Migration `…_m4b_admin_inbox_seen.sql` (§4). Applied to the test project by the architect.
2. `lib/inbox.ts`, `routes/admin/inbox.ts`, the mount line, the route inventory in
   `artifacts/api-server/tests/admin-routes.test.ts`.
3. `AdminLayout.tsx` badge; `NotificationCenterPage.tsx`; dictionary keys.
4. Invariants in `scripts/audit/check-invariants.mjs`: (a) no migration named `*_m4b_*` contains
   `FUNCTION` together with `stock_movements`, `counter_sales` or `counter_sale_payments`; (b) no
   `GRANT … TO anon` or `TO authenticated` on `admin_inbox_seen`.
5. Tests. Integration: a held sale leaves the count when posted, with `admin_inbox_seen` unchanged;
   a void is unread for another admin and not for `voided_by`; a staff token gets two counts,
   `events: null` and no key outside the staff list; a shopper's token gets 403 on all three routes.
   Offline: `itemsForRole` and `markUnread` (marker missing, marker older than the window, own actor,
   NULL actor) — as text-free unit tests if `store-unit` can import them, otherwise in the
   integration tier, stated in the notes.

No file over 200 lines is planned. If `NotificationCenterPage.tsx` would exceed it, the three sections
become three components.

## 12. Review — 2026-11-18 (architect, on the owner's delegation)

Checked against `main` at `ab4afaa`. **Verdict: approved as written**, deviations D1–D5 accepted.

- Event times are server clocks: `counter_sales.posting_date` is `now()` inside
  `post_counter_sale` (`20261113230400_post_counter_sale_payments.sql:14`), `voided_at` and
  `stocktakes.posted_at` likewise — so the marker comparison in §4 is sound; `sold_at` (device
  clock) is correctly not used.
- **Order:** after staff provisioning. Its amendment A1 opens the admin shell to staff with a
  role-filtered sidebar; this phase's staff counts link only to pages A1 shows staff
  (`/admin/inventory`, `/admin/reservations`). Check both links in the staff E2E.
- The migration takes the timestamp after the newest file in `supabase/migrations/` at
  implementation time, not after `20261116100100`.
- §9's four defects go to `docs/tasks/backlog.md` when this phase merges; §9.2
  (`GET /platform/notifications` is `requireUser`, so any shopper's token passes) has a security
  edge and is listed first.
