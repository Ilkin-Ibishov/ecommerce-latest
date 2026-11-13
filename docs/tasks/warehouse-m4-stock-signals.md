# M4 — Stock signals: low stock, reorder, dead stock

Spec. Architect-owned; the implementer reads it and never edits it.
Written 2026-11-13. Phase branch: `m4/stock-signals`.

Prerequisites, all merged: M1 (variant layer, ledger), M2a (cost projection), M2b
(stocktake), M2c (reservations and availability), M3a (counter sale).

---

## 1. Why this exists

M1 through M3a record what happened. The owner's three standing questions are not answered
anywhere in the product:

- What am I about to run out of?
- What should I order, and how much?
- What is my money sitting in that nobody is buying?

All three are answerable from data the earlier phases already wrote. None of them requires a
new source of truth — which is why this phase is small and why it should not grow.

It is also the most demonstrable thing in the product. A ledger is infrastructure; "these
nine things run out this week and here is the order" is what a shop owner recognises as
worth paying for.

## 2. Scope and order

Four pieces, in this order, each its own migration and commit:

1. `track_stock` enforcement — a latent defect, and everything after it depends on knowing
   which variants are stock-bearing.
2. Low stock — the smallest signal, and the one whose data already exists.
3. Dead stock — the same query shape, inverted, plus the cost projection.
4. Reorder suggestions — needs velocity, which is the only genuinely new computation.

Pieces 2 and 3 are independent of 4. If the phase has to be cut short, cut 4.

## 3. Customer context

One gift shop, hundreds of SKUs, tens of sales a day, one or two staff plus the owner. A
second shop is in conversation. The owner is usually on the premises. There is no buyer, no
procurement process and no supplier portal — "ordering" means the owner messages a supplier.

That context decides the shape of everything below: **suggestions, not automation.** Nothing
in this phase places an order, emails a supplier, or changes stock.

## 4. The invariant that defines this phase

> **A signal is derived, never stored.**

Low stock, days of cover, suggested quantity and dead-stock value are computed at read time
from the ledger and current state. No table in this phase holds a number that could drift
from the ledger, and no column named `is_low_stock`, `days_of_cover` or `suggested_quantity`
is added to `product_variants`.

This is the same rule the architecture ADR applies to bundle availability, for the same
reason: a stale signal is worse than a slow one, because nobody finds out it is stale.

**The one exception, and it is not a counter-example:** a record that a notification was
*sent* is a fact about the past, not a derived signal, and is stored (§6.4). The test is
whether re-running the computation could disagree with the stored value. It cannot disagree
about whether a message was sent.

## 5. Decisions already taken — do not re-litigate; flag if you believe one is wrong

1. **Signals compare against `available`, not `on_hand`.** M2c made availability a real,
   database-enforced number. Ten on hand with eight reserved is not eight-to-spare.
2. **Velocity is computed from `stock_movements`, not from sale documents.** A voided
   counter sale reverses its movement; a ledger-derived velocity is therefore self-correcting
   and a document-derived one is not.
3. **No forecasting.** Plain units-per-day over a fixed window. No seasonality, no smoothing,
   no safety-stock model. The shop sells tens of units a day; a model would be fitting noise.
4. **No automation.** No purchase order is created, no supplier is contacted.
5. **Weighted average cost** is the valuation basis, as decided in M2a. Dead-stock value uses
   the existing cost projection; this phase adds no costing logic.
6. **In-app first.** The notification centre already exists. WhatsApp per-variant alerting is
   explicitly not in this phase (§18).

## 6. Low stock

### 6.1 Threshold resolution

`product_variants.low_stock_threshold` (`numeric(12,3)`, nullable) exists from
`20261103210000_m1_schema_additions.sql`. `store_settings` carries a global
`low_stock_threshold`, seeded at 10, from `20260606110418_create_store_settings.sql`.

Resolution, in order: the variant's own threshold when not null; otherwise the tenant's
global setting; otherwise the variant is not monitored. A null variant threshold means
"use the global", not "never alert" — state that in the UI, because the opposite reading is
the natural one and will otherwise be filed as a bug.

### 6.2 Who is in scope

A variant is monitored when `track_stock = true` and it belongs to an active product.
Explicitly out: non-tracked variants (§9), bundles (a bundle has no stock of its own — its
components are monitored instead), and archived or deleted products.

### 6.3 The signal

A monitored variant is **low** when `available <= resolved_threshold`, and **out** when
`available <= 0`. Both appear in the same list, out first. Report the three numbers that
make the signal checkable — on hand, reserved, available — never the verdict alone. An owner
who cannot see why something is flagged stops trusting the flag.

### 6.4 Notifying, without becoming noise

`notifications.ts` already declares a `low_stock` type. **It is declared and not handled:**
the dispatch chain covers `order_confirmed` and `status_changed` only, so a `low_stock`
notification is written and immediately marked `failed` with "unhandled type". Fix that in
this phase or do not queue the type at all — leaving a type that always fails is worse than
having none.

Rules, which matter more than the delivery mechanism:

- **One digest, not one message per variant.** A shop crossing a threshold on fifteen
  variants in a day must receive one notification listing fifteen, not fifteen notifications.
  This is the single most likely way this feature becomes something the owner mutes.
- **Do not re-notify while a variant stays low.** Store the last notification per variant and
  suppress until it recovers above the threshold and falls again. This stored state is
  permitted by §4 — it records what was sent, not what is true.
- **Recovery is not an event.** Do not notify when something comes back into stock.

## 7. Dead stock

The inverse query, and the one with a number attached.

A variant is **dead** when `on_hand > 0` and no outbound sale movement exists in the last N
days. N is a setting with a default of 90; the screen lets the owner try 30, 60, 90 and 180,
because the right number is a judgement about their catalogue and not ours.

Report per variant: on hand, days since the last sale, days since first received, and
**on_hand × current weighted-average cost** — the capital sitting still. Total it. That
total is the point of the screen; a list of slow items without a money figure does not
change anyone's behaviour.

Two things this must not do:

- **Do not suggest a discount, a markdown or a disposal.** A seasonal item in the wrong
  season is not dead, and the system does not know which items are seasonal. Report; let the
  owner decide.
- **Do not call anything "dead" in the UI.** Use "not selling" or the equivalent in each
  locale. The owner shows this screen to staff.

Cost is owner-only. M2a put cost behind RLS and hid it from staff; the value column and the
total obey that, and a staff user sees the list without money. Do not solve this by hiding
the column in the component — the API must not return it.

## 8. Reorder suggestions

### 8.1 Velocity

Units sold per day for a variant, over a trailing window (default 28 days, same setting
family as §7), computed from `stock_movements` restricted to outbound sale reasons — the
online order decrement and the counter sale. Explicitly excluded: stocktake corrections,
receipts, and any future assembly movement. A correction is not demand.

### 8.2 The suggestion

```
days_of_cover    = available / velocity          (velocity > 0)
suggested_qty    = ceil( target_days * velocity - available - on_order )
```

`target_days` is a setting, default 60, matching the ADR's framing of a 60-day reorder
horizon. A suggestion is only shown when `suggested_qty > 0`.

### 8.3 Honesty requirements, which are part of the spec and not polish

- **Show the evidence next to every suggestion**: units sold in the window, available,
  velocity, days of cover. The formula must be reconstructable by the owner from what is on
  screen.
- **Say when there is not enough data.** A variant with one sale in 28 days has a velocity
  whose error bar is larger than itself. Below a minimum number of sales in the window
  (default 3) show the sales figure and no suggested quantity. A confident number computed
  from one data point is the fastest way to lose the owner's trust in the whole screen.
- **Zero velocity is not a reorder.** A variant that sold nothing belongs in §7, not here.

## 9. `track_stock` — make the flag mean what it says

**This is a defect fix, not a feature, and it lands first.**

`product_variants.track_stock` (boolean, NOT NULL, default true) was added in
`20261103210000_m1_schema_additions.sql` and documented there as "indicates whether physical
stock is counted (false for services/made-to-order)". The inventory routes read and write it.
**No ledger or counter-sale code reads it.** Setting it false today does nothing: the variant
is still decremented, still has an on-hand number, and would still appear in every signal
this phase adds.

Required behaviour:

- A stock movement for a `track_stock = false` variant is **rejected in the database**, not
  in the application. The apply trigger from M1 is where this belongs.
- A counter sale may include a non-tracked line: it sells, it is priced, it reaches the
  receipt and the revenue figures, and it writes no movement.
- Availability for a non-tracked variant is unlimited — it is never out of stock and never
  low, and the three-number availability view must not report a misleading zero for it.
- A bundle line may reference a non-tracked variant (gift wrapping inside a set is the
  obvious case). The bundle's availability is the minimum over its *tracked* components.
- A non-tracked variant never appears in a stocktake count sheet.

The design note must first establish, against the test project, whether any variant currently
has `track_stock = false`. If so, the migration states what happens to movements already
written for it; a trigger added without that answer will reject nothing today and surprise
someone later.

Add an invariant to `scripts/audit/check-invariants.mjs`: no code path writes to
`stock_movements` for a variant whose `track_stock` is false, and a database test asserting
the trigger rejects it. Per `AGENTS.md`, every mechanically expressible rule becomes a check.

## 10. Where these appear

No new top-level navigation. Three places:

1. **Dashboard** — a count and a link for each of the three signals. The owner's landing
   page is where "what needs me today" belongs.
2. **Inventory page** — low-stock and not-selling as filters on the list that already
   exists, not as separate screens. Same `useAdminList` + `<DataTable>` pattern as every
   other admin list, per `.agents/rules/frontend.md`.
3. **Reorder** — its own screen, because it is a working list the owner reads top to bottom
   with a supplier on the phone. Group by supplier, since that is the unit of a conversation.

All three locales (`az`, `ru`, `en`), every string through `t()`, keys added to all three
dictionaries. The `i18n-consistency` test enforces it.

Run `modern-web-guidance` `search` before writing the table, filter and dashboard UI, per
`.agents/rules/frontend.md`.

## 11. Roles and grants

- **Owner / admin**: all three signals, including every cost and value figure.
- **Staff**: low stock and not-selling lists **without** cost, value or margin. Useful for
  shelf work; no commercial information.
- **anon / authenticated**: nothing. These are admin endpoints.

Whenever a grant in this phase names `anon` or `authenticated`, state who actually holds that
role in this product — in this one, `authenticated` includes every signed-in shopper. M2c
shipped a view that leaked deposit names and amounts to every customer for exactly this
reason. New views get `security_invoker = true` and no `authenticated` grant.

## 12. Every rule: ordinary flow and intersections

`warehouse-m2c-reservations.md` §11 established this requirement and the M2b audit proved
why: five of its six findings were faithful implementations of rules that were exact and
wrong, because each was right alone and wrong against an earlier decision.

For every rule in this phase, the design note answers two questions in writing: **how does it
behave in the ordinary flow**, and **which earlier decision does it intersect**. The
intersections already identified — the design note must address each, and is expected to find
more:

| This phase's rule | Intersects | What must be true |
|---|---|---|
| Signals read `available` | M2c reservations | A deposit held against stock makes it unavailable, so it must be able to trigger a low-stock signal even with on-hand unchanged |
| Velocity from movements | M3a void | A voided counter sale reverses its movement, so velocity drops without special handling. Verify, do not assume |
| Velocity from movements | M3a `needs_owner` | A sale flagged for the owner still consumed stock and still sold. It **counts** toward velocity |
| Velocity excludes corrections | M2b stocktake | A shrinkage correction reduces on-hand and is not demand. Excluding it is required, not optional |
| Dead-stock value | M2a cost RLS | Cost is owner-only; the API must not return value columns to staff |
| Dead-stock "days since last sale" | M2b opening count | A variant first entered by opening count has no sale history and is not therefore dead on day one. Use days since first receipt as the floor |
| Low stock on components | M3a minimal bundle | A bundle holds no stock. Alerting on the bundle is wrong; alerting on its components is right |
| `track_stock` rejection in the apply trigger | M1 ledger immutability | The rejection must not weaken the append-only guarantee or the existing before-insert apply logic |
| Every new table and view | multi-tenant RLS | Thresholds, settings and notification records are tenant-scoped like the tables around them |

## 13. Open questions — answer in the design note, before any migration

1. **Is there an "on order" quantity at all?** §8.2 subtracts `on_order`. M2a has goods
   receipts; establish whether an expected-but-not-received state exists. If it does not,
   either drop the term from the formula and say so on screen, or justify adding the state —
   do not invent a column quietly.
2. **Do suppliers carry a lead time?** If not, the reorder screen groups by supplier without
   promising a delivery date. Do not add a lead-time column unless §8 actually uses it.
3. **Where do the settings live?** `store_settings` already holds `low_stock_threshold`.
   Decide whether the window, target days and minimum-sales values join it or get a
   dedicated table, and say why.
4. **Database or application?** The codebase computes availability in the database and
   reports via RPC (`get_margin_report`). State where each signal is computed and why,
   consistent with the existing pattern rather than beside it.
5. **Does any variant have `track_stock = false` today?** Query the test project. §9's
   migration depends on the answer.
6. **Units of measure.** Thresholds and quantities are `numeric`; a variant sold by the metre
   has a fractional velocity. Confirm `ceil` on a suggested quantity is right for every unit
   of measure, or say where it is not.

## 14. Open questions for the customer

Engineering starts without these; each has a default that ships.

1. How far back should "not selling" look — 30, 60, 90 days? *Default: 90, adjustable.*
2. How many days of stock do you want to hold after an order arrives? *Default: 60.*
3. Would you want one daily summary of what is running low, or to check the screen yourself?
   *Default: one daily summary in the app, no WhatsApp.*
4. Do you want staff to see what is running low? *Default: yes, without any cost figure.*

## 15. Deliverables, in order

1. **Design note first** at `docs/design-notes/m4-stock-signals.md`, answering §13 and
   repeating §12 for every rule you write. Commit it and **stop** for review. No migration,
   no route, no component before that review.
2. `track_stock` enforcement: migration (trigger change), invariant, database test.
3. Settings: whatever §13.3 decided, with the existing `low_stock_threshold` left working.
4. Low stock: query or RPC, admin endpoint, inventory-page filter, dashboard count.
5. `low_stock` notification: digest, per-variant suppression, and the dispatch branch that
   `notifications.ts` is missing.
6. Dead stock: query or RPC with owner-only value columns, inventory-page filter, dashboard
   count.
7. Reorder: velocity computation, suggestion endpoint, reorder screen grouped by supplier.
8. Tests at every tier, and `az` / `ru` / `en` keys in all three dictionaries.

## 16. Definition of done

- `pnpm run typecheck`, `pnpm run test:unit` and `pnpm run audit:invariants:strict` pass.
- Integration and E2E green in CI against the test Supabase project. State which tiers you
  actually ran locally and which only ran in CI — do not claim the integration tier passed in
  a bare checkout.
- Every migration applied to the test project, not to production.
- A staff-role test proves no cost or value figure reaches a staff token, through the API and
  not only in the UI.
- A test proves the low-stock digest sends one notification for many variants, and does not
  re-send while a variant stays low.
- A test proves a `track_stock = false` variant cannot write to `stock_movements` and can
  still be sold at the counter.
- `docs/audits/m4-implementation-notes.md` records what is and is not verified.

## 17. Not in M4

Named so they are not added by reflex:

- Purchase-order generation, supplier emails, or any outbound ordering.
- Seasonality, forecasting, smoothing, safety stock, ABC analysis.
- WhatsApp or email alerting per variant. The channel exists; the decision is in-app first.
- Discount, markdown or disposal suggestions for not-selling stock.
- Multi-location stock, transfers, or per-location thresholds.
- Real assembly (kit stock, `assembly_consume` / `assembly_produce`) — §16.6 closed this.
- Cycle-count scheduling.
- Any stored signal column on `product_variants` — see §4.

## 18. What is not verified

State this honestly in the implementation notes rather than implying coverage:

- Velocity has never run against a real sales history. The test project's history is
  fixtures, days old, and will produce suggestions that look wrong for reasons that are not
  bugs. Say which figures came from fixtures.
- No threshold has been tuned by a shop owner. Every default in this spec is a guess with a
  reason, not a measurement.
- Dead-stock value depends on the cost projection being correct for variants that went
  negative and were later received. `m2a_replay_negative_basis` exists; confirm it covers
  receipt-after-negative, not only the oversell.
