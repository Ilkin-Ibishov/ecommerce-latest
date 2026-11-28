# M4b store notifications — fix round 1

Read `AGENTS.md` and `artifacts/api-server/AGENTS.md`. Branch `m4b-fix-1` (cut from
`phase/m4b-store-notifications`); it is checked out. Commit there only. Never commit to `main`. Do
not touch any Supabase project and do not run SQL. Do not edit
`supabase/migrations/20261118130000_m4b_admin_inbox_seen.sql` and add no migration.

An adversarial audit of this branch against `docs/tasks/m4b-store-notifications.md` found the
defects below. Five changes, one commit each. Nothing else: no refactor nearby, no renames.
If a name or a fact below is wrong against the code, stop on that item and say so in the notes —
do not guess a different fix.

## 1. Two integration tests cannot pass

`artifacts/api-server/tests/m4b-inbox.integration.test.ts` inserts into `counter_sales` directly
(the held-sale test and the voided-sale test). The table makes `payload_hash`, `posting_date` and
`posted_by` NOT NULL without a default (`supabase/migrations/20261111120300_m3_counter_sales.sql`),
`chk_counter_needs_owner_reason` requires `needs_owner_reason` for a held sale, and the deferred
trigger `trg_counter_sales_has_payments` (`20261113230400_post_counter_sale_payments.sql`) raises
ST027 at commit when the sale has no payment rows. Both inserts fail.

Create the sales through the API the way `tests/m3a-counter-routes.integration.test.ts` does:
`createStockedVariant` from `tests/helpers/stocked-variant.ts`, then `POST /admin/counter/sales`
with a body like its `saleBody()`. For the held sale, read `routes/admin/counter-sales.ts` and the
live `post_counter_sale` to find which input makes the sale `needs_owner`, and use that. Void with
`POST /admin/counter/sales/:id/void` and resolve a held sale with `/post-pending`. Keep every
assertion the tests make today. Clean up what you create, as that file does.

## 2. Mismatch events disappear once there are 200 flagged lines

`fetchAdminEvents` in `artifacts/api-server/src/lib/inbox-queries.ts` reads `counter_sale_lines`
with `price_mismatch`/`reservation_override` and `.limit(200)`, no date filter and no order, then
builds an `id.in.(…)` filter from those ids. Once a shop has more than 200 flagged lines in its
history, today's discounted sale may not be among them and never shows.

Replace the two queries with one: `counter_sales` in the 14-day window
(`.gte("posting_date", fourteenDaysAgo)`), `.neq("status", "needs_owner")` (a held sale is not
"posted"), selecting `id, sale_number, posting_date, cashier_id, total_mismatch,
counter_sale_lines(price_mismatch, reservation_override)`, ordered by `posting_date` desc. Keep in
JS the sales where `total_mismatch` or any line flag is true, then take 50. Build the same event
objects as today. Extend `artifacts/store/src/__tests__/m4b-inbox.unit.test.ts` only if the event
building moves into a pure function you can import; do not test a function defined in the test.

## 3. Database errors read as "nothing needs you"; `as any` in new code

In `inbox-queries.ts` and `routes/admin/inbox.ts` no query checks `error`. A failed query gives a
0 count or an empty feed with HTTP 200, and `POST /admin/inbox/seen` answers 204 even when the
upsert fails.

- Every query in `fetchNeedsYouCounts` and `fetchAdminEvents`: if `error` is set, throw. The three
  routes catch, log through `req.log` and answer `500 { error: "Failed to load inbox" }`.
  `/admin/inbox/seen` answers 500 when the upsert fails.
- The low-stock count: `get_low_stock_signals` returns rows; `data.length` is capped by PostgREST's
  row limit. Use `admin.rpc("get_low_stock_signals", { p_search: null, p_status: null }, { count: "exact", head: true })`
  and read `count`. Check that supabase-js in this workspace accepts that third argument; if it
  does not, stop on this sub-item and say so.
- Type `admin` as `SupabaseClient<Database>` the way other files under `src/lib/` do (find one and
  follow it), remove `(markerRes.data as any)` and the `any` callbacks. No new `as any`.

## 4. The "seen" marker uses the API clock, and the badge stays stale

`POST /admin/inbox/seen` stores the API host's `new Date()`. Event times are database values, so an
event committed just after the press but timed before it is never unread, and API clock skew hides
more. After "Mark all as seen" the layout badge (`AdminLayout.tsx`, `refreshInboxCount`) keeps the
old number until the route changes.

- The client sends `{ seen_through: <time of the newest event it rendered> }` (ISO string, or
  omit it when no event was shown). The route validates it with zod (`z.string().datetime()`,
  optional) and stores `seen_through` if given and not in the future by the server clock,
  otherwise `new Date().toISOString()`.
- On success `NotificationCenterPage` dispatches `window.dispatchEvent(new Event("admin-inbox-changed"))`;
  `AdminLayout` listens for it and calls `refreshInboxCount`. Remove the listener on unmount.
- Add one integration case to `m4b-inbox.integration.test.ts`: `seen_through` older than an event
  leaves that event unread.

## 5. English fallbacks and browser-locale dates in the az/ru UI

`artifacts/store/src/components/admin/notifications/HappenedSection.tsx` falls back to the literals
`"Customer"` and `"Staff"` when a name is null (most phone-OTP users have no `full_name`) and formats
times with a bare `toLocaleString()`.

- Add `Notifications.unknownCustomer` and `Notifications.unknownStaff` to `az.ts`, `en.ts` and `ru.ts`
  (az: "Müştəri", "İşçi"; en: "Customer", "Staff member"; ru: "Покупатель", "Сотрудник") and use them.
- Format times with the app locale from the i18n context (see how another admin page formats a
  date with it; follow that).

## Notes

Append a "Fix round 1" section to `docs/audits/m4b-store-notifications-notes.md`: per item what
changed, every test added or changed by name, and the real output of `pnpm run typecheck`,
`pnpm test:unit` and `pnpm run audit:invariants`. You cannot run the integration tier — it needs
Supabase credentials and a running server. Say so; do not claim it passed. Run `pnpm run docs:index`
if you add a file under `docs/` or `prompts/`.

## Done means

The three local commands pass. Five commits. No `@ts-ignore`, no new `as any`, no `.skip()`, no
deleted or weakened test, no migration change. Do not push.
