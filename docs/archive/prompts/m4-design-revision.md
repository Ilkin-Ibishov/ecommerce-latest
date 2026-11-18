# Phase M4 — design note revision, then stop

Read `AGENTS.md`, then `docs/audits/m4-architect-audit.md` (all of it, including "Split"), then the
spec `docs/tasks/warehouse-m4-stock-signals.md` §6.4, §9 and §12. Do not edit the spec or the audit.

Work on branch `m4/stock-signals-core`. It is already checked out. Never commit to `main`. Do not use
`m4/stock-signals`; it is the old, unsplit branch.

**This round is a design note only.** Revise `docs/design-notes/m4-stock-signals.md`, commit it, and
**stop**. No migration, no route, no component, no test, no other file. The first M4 round went from
note to migrations in 27 minutes with no review; that is why this round exists.

Do not touch any Supabase project, by MCP or otherwise. The facts you need about the test project,
established read-only on 2026-11-14:

- No M4 migration has been applied. The chore `counter_sale_payments` has been, and is merged.
- Exactly one variant has `track_stock = false`. It has zero movements and `on_hand` 0.
- `product_variant_availability` columns, in order: `variant_id, product_id, sku, price, on_hand,
  reserved_quantity, available_quantity, deficit_quantity`. `product_variant_public_availability`
  depends on it.
- `counter_sales.payment_method` has `CHECK (payment_method IN ('cash','card','other'))`.

## What to revise

Add a section "Revision 2 — 2026-11-14" at the top listing what changed and which audit finding each
change answers. Then rewrite the affected sections in place. Three subjects.

### 1. The low-stock digest (audit M2) — replace §5

The current design has a `POST …/evaluate-digest` route that nothing calls and an `in_app` row that
nothing reads. Answer these four questions, each with file-and-line evidence from the codebase:

1. **What causes an evaluation?** Name the event and the code path. No scheduler and no background
   job (`AGENTS.md`: tens of sales a day). The architect's leaning is: evaluate in the API after the
   events that lower stock (counter sale posted, order stock decremented), in the request path. If you
   choose otherwise, say why.
2. **How does the owner learn of it without opening the admin?** If the answer is WhatsApp, show where
   the owner's number comes from today; if no such setting exists, say so and say what is needed. If
   the answer is "they do not; the dashboard list is the signal", then say that plainly and remove the
   `low_stock` type, the route and the suppression table from the plan. Spec §6.4 allows exactly these
   two outcomes: handle the type, or do not queue it. A type that is queued and read by nobody is
   neither.
3. **Where is the digest read**, component and query, if anything is stored for reading.
4. **What happens when a step fails?** The suppression write and the send must not be able to diverge:
   a failed suppression write followed by a send repeats the digest on every evaluation. State the
   order of operations and what is in one transaction.

For the rule you choose, write the two answers the process requires: how it behaves in the ordinary
flow (fifteen variants cross their threshold in one day; one variant hovers at its threshold), and
which earlier decisions it meets (M3a counter sale idempotent replay, `needs_owner` sales that wrote no
movement, M2c reservations expiring, the `notifications` table's existing readers and `NOT NULL`
columns).

### 2. A variant switched between tracked and non-tracked (audit M3) — extend §4

Today nothing guards the switch, and the trigger rejects every movement for a non-tracked variant.
Design the rule for both directions, and for each write the ordinary flow and the intersections:

- **true → false.** What must be true first (`on_hand`, open stocktakes containing the variant, active
  reservations)? Where is it enforced — it must be in the database, not only in the route.
- **After the switch**, what does `void_counter_sale` do for a sale of that variant made while it was
  tracked? Letting the reversal through puts stock on a non-tracked variant; rejecting it makes the
  sale un-voidable. Choose, and show that `verify_stock_integrity` still holds afterwards.
- **false → true.** `on_hand` starts from what? State how the first real quantity gets in.
- Intersections to address by name: M1 "stock changes only through the ledger", M2b stocktake posting,
  M2c reservation fulfilment, M3a void, bundles.

Then the two spec §9 bullets that were never implemented, with the files that change:

- bundle availability is the minimum over *tracked* components;
- a non-tracked variant never appears on a stocktake count sheet.

### 3. The migration plan (audit B2, B3, m1) — update §4.4 and §8

These are decided; reflect them, do not re-argue them.

- **B2.** `track_stock` goes at the *end* of the view's select list. Not `DROP VIEW`.
- **B3.** `20261113220010` must not redefine `post_counter_sale`. A new migration timestamped after
  `20261113230400` defines it once, carrying both the `counter_sale_payments` insert and the
  `track_stock` filter. Both invariants (`post-counter-sale-writes-payments`,
  `no-non-tracked-variant-movements`) must pass on the result.
- **m1.** Unlimited availability is `NULL`, not `999999`. List every reader of
  `available_quantity` — storefront, admin, API, SQL — and what each does with `NULL`. The public view
  is read by `anon`.
- List every migration file in the order it will be applied, one concern per file.

## Do not

- Do not reintroduce a TypeScript fallback for any signal. An RPC error is a 500 (audit M1).
- Do not design the remaining findings (`as any`, m2–m5) here; they go in the fix-round prompt.
- Do not copy the previous note's reasoning where the audit contradicts it.
- If you believe an audit finding or a decision above is wrong, say so in the note with evidence and
  design to the decision anyway. Do not deviate silently.

## Done means

Exactly one commit on `m4/stock-signals-core`, touching only `docs/design-notes/m4-stock-signals.md`:
`docs(m4): revise design note for digest, non-tracked switch and migration plan`. Then stop and wait
for review. No tiers need to run; no code changed.
