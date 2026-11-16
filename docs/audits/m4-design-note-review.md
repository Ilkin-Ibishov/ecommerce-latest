# Review — M4 design note, revision 2

2026-11-15, architect. `docs/design-notes/m4-stock-signals.md` at `92affcc` on
`m4/stock-signals-core`, written by the builder on `prompts/m4-design-revision.md`. The builder
committed one file and stopped, as asked.

**Verdict: approved to implement, with the six decisions below. Where a decision differs from the
note, the decision wins.** No third design round: every open point is decided here and goes into the
fix-round prompt verbatim.

## Decisions

### D1. No low-stock notification in M4 (note §5: Outcome B, not A)

The note designs a WhatsApp digest (A) and offers "the dashboard is the signal" (B) as an
alternative without choosing. B is the decision.

- Spec §14.3's default is "one daily summary in the app, no WhatsApp". A is WhatsApp.
- A as designed evaluates after every sale and sends whatever is newly low. Its own §5.3 case 2
  says fifteen crossings spread over a day are fifteen messages. Sales here are spread, not batched,
  so that is the ordinary flow, and it is exactly what spec §6.4's first rule forbids.
- A stores `owner_notification_phone` in `store_settings`. That table's policy is
  `"Public read store_settings" FOR SELECT USING (true)`: the owner's number would be readable by
  `anon`.
- No component reads a store-level in-app notification, so the spec's own default has no reader
  either. The dashboard count and the inventory filter (deliverables 4 and 6) are the daily summary.

So, per spec §6.4 ("fix that … or do not queue the type at all"): remove the `low_stock` type from
`notifications.ts`; no evaluate route, no `low_stock_notification_events`, no
`evaluate_low_stock_digest`, no `owner_notification_phone`, no migration `…231400`. Deliverable 5
becomes this removal. Nothing is evaluated in the checkout or till request path.

Reopens when the customer asks to be told without opening the admin. It then needs a once-a-day
batch and a setting that is not publicly readable.

### D2. A void after the switch writes no movement (note §4.2: not "let the reversal through")

The note lets a reversal through for a non-tracked variant when `correlation_id` matches an earlier
movement. That puts `on_hand` back above zero on a variant the guard only let switch at zero, and
the exception also admits the other `correlation_id` writer, `reverse_goods_receipt`
(`20261104110000_m2a_functions_triggers.sql:630`), which the note does not mention.

Decision: the trigger has no exception. `void_counter_sale` filters `track_stock = true` for its
reversing movements, the same filter the sale functions get. The void succeeds, revenue reverses,
`on_hand` stays where it was, and `ledger_vs_on_hand` is untouched because neither side moved.
`reverse_goods_receipt` on a non-tracked variant gets ST030; the message says to turn tracking back
on first, which false → true always allows.

Ordinary flow: a variant is created non-tracked and never changes; none of this runs. Known limit,
accepted: a unit returned after the switch is not on the books until tracking is turned on and it is
counted. That is what "not tracked" means.

### D3. The reservation guard is `status = 'active'`, with no expiry test

The note's text says "no active reservations"; its SQL adds `expires_at > now()`. An expired but
still-active reservation would pass the guard and be fulfilled later. Use `status = 'active'` alone:
the owner cancels it first. With that, `fulfil_reservation` can never meet a non-tracked variant and
is **not** changed in this phase; if one is ever reached it fails closed with ST030. Creating a
reservation for a non-tracked variant is refused in the route (400), as the note says.

### D4. The `NULL` reader list is incomplete

The note's table names `ProductDetailPage.tsx`, which does not exist, and omits readers. Every file
below reads `available_quantity` and must handle `NULL` as unlimited or exclude the row:

`artifacts/api-server/src/routes/{products,categories,orders,inventory}.ts`,
`routes/admin/{counter-lookup,reservations,inventory-signals}.ts`,
`artifacts/store/src/components/storefront/{ProductDetail,QuickViewModal}.tsx`,
`pages/storefront/{HomePage,ProductPage,ProductsPage}.tsx`,
`pages/admin/{InventoryPage,ReorderPage}.tsx`.

The fix round's notes list each with what it does. `Number(null)` is `0`; a reader left alone turns
"unlimited" into "out of stock".

### D5. Migrations

- The four M4 migrations already on the branch (`20261113220000` and the rest from `3671707` and
  `0aefc55`) are deleted and replaced by the note's `…2310xx` sequence. None was ever applied
  anywhere, so nothing is orphaned.
- The note's first file holds the movement trigger, the switch guard, the stocktake guard and the
  view. Split the view into its own file; one concern per file.
- No `…231400`, and `…231300` does not seed `owner_notification_phone` (D1).
- `…231100` changes `post_pending_counter_sale`, `decrement_order_stock` and `void_counter_sale`
  (D2), not `fulfil_reservation` (D3).

### D6. One thing the builder must check before writing the stocktake guard

Stocktake lines are added one at a time by scan (`routes/admin/stocktake-lines.ts`); there is no bulk
sheet generator, so the insert guard is enough for the sheet. Not established: what `post_stocktake`
does with tracked variants that are *absent* from the sheet. If it corrects them, it must not touch
non-tracked ones. Read the function and say which it is in the notes.

## What the note gets right

Column order (B2) and the single `post_counter_sale` after `…230400` (B3) are as decided. The
true → false guard is in the database, on `UPDATE OF track_stock`, with distinct error codes. Bundle
availability over tracked components and the stocktake insert guard cover the two unimplemented §9
bullets. Signals stay in RPCs with no fallback. Evidence is cited by file and line throughout.

## Not checked

The line numbers the note cites were not verified one by one. The reader list in D4 comes from a
grep for `available_quantity` under the two `src` trees, excluding tests and generated types; a
reader that reaches the value under another name is not in it.

## Owner's decision on D1 — 2026-11-15

Confirmed by the owner: no low-stock notification in M4. The shop owner opens the dashboard every
day and sees the count there.

The owner also wants a store-level notification system in the product, with the low-stock alert as
one of its messages. That is not on `docs/tasks/warehouse-roadmap.md` today and is not M4. What
exists: a `notifications` table and `lib/notifications.ts`, which send WhatsApp messages to
*customers* about their orders, and `NotificationCenterPage.tsx`, which shows platform announcements
from the control plane. Nothing delivers a store's own operational messages to its owner or staff.
It needs a roadmap entry and its own spec before any code; D1's reopening condition becomes "when
that system exists".
