# M4b — Notifications: the admin's inbox

Status: active — design note approved (2026-11-18); implement after staff provisioning.

Spec, 2026-11-15. Written by the architect after the owner asked for a notification system in the
product (recorded in `docs/archive/audits/m4-design-note-review.md`, "Owner's decision on D1").

## 1. Why this exists

M4 computes what the owner should look at. Nothing puts it in front of them: each signal lives on
its own screen and the owner has to know to go there. The same is true of everything a customer or
a staff member does while the owner is not watching — an online order arrives, a sale is voided, a
sale is posted below list price — it is all recorded and none of it is announced.

M4 removed its own low-stock notification (review D1) because a message nobody reads is worse than
none. This phase is where that alert belongs.

## 2. Scope and order

One phase, in-app only: a bell in the admin header with a count, and one page behind it. No message
leaves the application (§13). M4 must be merged first; the low-stock count reads its RPC.

## 3. The invariant that defines this phase

> **A notification is a view of a record that already exists. This phase stores nothing that can be
> derived.** The only new stored state is what each user has already seen.

Everything shipped so far records what happened: a voided sale carries `voided_at` and `voided_by`,
an order carries `created_at`, a held sale carries `status = 'needs_owner'`. A second copy of those
facts in a notification row can only disagree with the first — "3 variants low" after the delivery
arrived, "sale needs you" after it was posted. So there is no event table, no trigger that writes
notifications, and **no change to any money or stock function**. This is M4 §4 again, for the same
reason.

## 4. Two kinds of item

**Needs you** — a state. It is a count with a link, it is true right now, and it disappears by
itself when the thing is dealt with. It has no "read" flag: reading it does not resolve it.

**Happened** — an event someone else caused. It is a dated line, newest first, and it is unread
until the user has seen the page.

Candidates. The design note confirms each against the schema and drops any whose source does not
exist as described (§9.1):

| Kind | Item | Source |
|---|---|---|
| Needs you | Counter sales waiting for the owner | `counter_sales.status = 'needs_owner'` |
| Needs you | Online orders not yet handled | `orders.status = 'pending'` |
| Needs you | Variants running low | M4's `get_low_stock_signals` |
| Needs you | Holds past their date, still active | `reservations`: `status = 'active'`, `expires_at` in the past (nothing expires them automatically) |
| Needs you | Customer messages that failed to send | `notifications.status = 'failed'` |
| Needs you | Reviews waiting for approval | `comments.approved = false` |
| Happened | New online order | `orders.created_at` |
| Happened | Counter sale voided | `counter_sales.voided_at`, `voided_by`, `void_reason` |
| Happened | Sale posted off list price, or over a reservation | `counter_sales.total_mismatch`, `counter_sale_lines.price_mismatch`, `reservation_override` |
| Happened | Goods receipt reversed | `goods_receipts.status = 'reversed'` |
| Happened | Stocktake posted | `stocktakes.posted_at`, `posted_by` |

An event the acting user caused themselves is not shown to them as unread.

## 5. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **In-app only.** The owner opens the admin every day (owner's statement, 2026-11-15).
- **Derived, not stored** (§3). If the note finds an item that cannot be derived, it says so and
  proposes the smallest stored thing; it does not add a general event table for one item.
- **The existing `notifications` table is not reused.** It is the outbound log of WhatsApp messages
  to customers: `recipient text NOT NULL`, a delivery `status`. It keeps that one meaning.
- **Unread is one marker per user, not a flag per item.** "Mark all as seen" is the only action. A
  shop has one to three admin users; per-item state is volume that does not exist.
- **No realtime subscription.** The count refreshes on navigation and on window focus.
- **One bell, one page.** `/admin/notifications` exists and shows platform announcements from the
  control plane. Those become one section of the same page, not a second inbox.
- **Events look back a fixed window** (default 14 days), not forever. Older history is what the
  sales, orders and stocktake screens are for.

## 6. Who sees what

`authenticated` in this product is every signed-in shopper. Nothing in this phase is granted to
`anon` or `authenticated`; every read goes through an admin route and the service-role client, like
M4's RPCs.

- **Owner (`admin`):** everything in §4.
- **Staff:** "Needs you" items only, and only those whose target screen the staff role can already
  open. No money figure, no cost, no event feed — the feed is largely a record of what staff did.
- The filter is applied in the API, not in the component (M4 §11's rule).

## 7. Every rule: ordinary flow and intersections

For each rule the design note writes both answers. The ones already visible:

| Rule | Ordinary flow | Meets |
|---|---|---|
| States are live counts | Owner opens the admin in the morning: "2 sales need you, 5 low". Handles the two; the count drops without anyone marking anything | M3a `post_pending_counter_sale`; M4 thresholds |
| Events unread until seen | Staff voids a sale at 14:00; owner sees one unread line that evening | M3a void; staff role |
| Own actions are not unread | The owner voids a sale themselves; the bell does not light | `voided_by` vs the session user |
| Fixed look-back | A two-week holiday: the owner returns to 14 days of events, not a year | first sign-in of a new admin: what is "unseen" for a user with no marker? |
| Staff see states only | Staff sees "3 online orders to handle", not who voided what | staff-provisioning roles; M2b blind counting — a stocktake line must not reveal `on_hand` |
| Low stock is a count here | "5 variants low" links to the inventory filter | M4 D1; a non-tracked variant is never low |

## 8. Where it appears

- A bell in the admin header: the number of "needs you" items plus unread events. Zero shows no badge.
- `/admin/notifications`: "Needs you" first, then "Happened", then platform announcements. Every
  line links to the screen where the thing is handled.
- `az`, `ru` and `en` keys for every label. No English literal returned from SQL (M4 audit m3).
- Frontend work follows `.agents/rules/frontend.md`: `modern-web-guidance` first.

## 9. Open questions — answer in the design note, before any migration

1. For each row of §4: the exact table, column and predicate, with file and line. Drop what does
   not exist. Add nothing that is not on the list without saying why.
2. Where the per-user marker lives, its RLS, and what a user with no marker sees.
3. One query or several: a single RPC returning the counts and the feed, or one small query per
   item in the route. Prefer whichever keeps cost and money columns out of the staff path by
   construction.
4. How "own actions" is decided for each event type, and what happens where the actor column is null.
5. How the platform-announcement section keeps its existing unread count without two competing badges.
6. What the bell costs: how many queries per page navigation, and whether that is acceptable at
   this shop's size without caching. (`AGENTS.md`: no caching for volume that does not exist.)

## 10. Open questions for the customer

Engineering starts without these; each has a default that ships.

1. Should staff see anything here? *Default: the "needs you" items they can act on, nothing else.*
2. How far back should "what happened" go? *Default: 14 days.*
3. Is there anything on the list you would never want to see? *Default: all of §4 is on.*
4. Would you ever want this on your phone when the admin is closed? *Default: no — see §13.*

## 11. Deliverables, in order

1. **Design note first** at `docs/design-notes/m4b-store-notifications.md`, answering §9 and
   repeating §7 for every rule. Commit it and **stop** for review.
2. The per-user marker: migration, RLS, explicit policies.
3. The read path: route(s), role filter in the API, Zod-validated responses.
4. The bell and the page, with the platform section folded in.
5. Invariants in `scripts/audit/check-invariants.mjs`: no migration in this phase redefines a
   function that writes `stock_movements`, `counter_sales` or `counter_sale_payments`; no grant on
   this phase's objects to `anon` or `authenticated`.
6. Tests at every tier. At least: a state disappears when resolved without any write to this
   phase's table; an event is unread for the owner and not for its actor; staff receive no event
   and no money field; a shopper's token gets 403.

## 12. Definition of done

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. Every migration applied
to the test project. Integration and E2E green in CI. `docs/audits/m4b-implementation-notes.md`
states which tiers ran. No new file over 200 lines without the reason in the design note.

## 13. Not in this phase

| Not built | Re-open when |
|---|---|
| WhatsApp or SMS to the owner | The owner asks to be told with the admin closed. It then needs a once-a-day batch, a recipient setting that is not in the publicly readable `store_settings`, and the outbound `notifications` table as its send log |
| Browser push, sound, desktop alerts | A shop keeps the admin open on the till all day and misses online orders |
| Per-user or per-type preferences | A user asks to turn one item off (§10.3) |
| Realtime updates | The focus-and-navigation refresh is observed to be too slow |
| Anything shown to shoppers | Not this system. Customer messages stay in `lib/notifications.ts` |

## 14. What is not verified

The sources in §4 were read from the migrations and `schema.sql`, not checked row by row against the
test project. `orders.status = 'pending'` is assumed to mean "not yet handled"; the order status
enum has other values and the design note must say which ones count. Whether staff can open the
orders screen today was not checked. The customer has not been asked §10.
