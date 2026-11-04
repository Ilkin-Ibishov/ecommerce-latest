# M2a — Goods Receipt, Suppliers, Weighted-Average Cost, Margin Read

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants that outlive this phase live in `.agents/rules/inventory.md`. Architecture:
`docs/tasks/warehouse-architecture.md`. Current state: `docs/STATUS.md`.

## 1. Why this exists

M1 made quantities **true**. It did not make them **mean** anything.

The owner's stated top pain is not knowing what actually earns money. He prices from memory, buys
from several sources at different prices, and has never seen a margin figure. Quantity alone does
not answer his question; quantity multiplied by a cost he trusts does. Cost is the first thing in
this product he would pay for, and it is the reason he will keep entering data after week three.

There is a second, harder reason this phase comes before stocktake and before the counter: **cost
cannot be backfilled.** A receipt entered without a price is a row that can never be repaired,
because nobody remembers in March what a box of mugs cost in November. Every day the system runs
without cost capture produces history that is permanently worthless for margin.

## 2. Phase split — this is M2a of two

M2 ships as two branches:

- **M2a (this work order)** — suppliers, goods receipt, weighted-average cost, margin read
- **M2b (specified separately)** — stocktake and reservations/deposits

The split is deliberate. M1 was 28 commits across 59 files and needed four review cycles; a diff
that size makes the adversarial audit expensive and shallow. Narrower branch, sharper audit.

The order is not arbitrary either: a stocktake correction that **finds** stock has to value it, and
a found unit is valued at the running average this branch produces. Stocktake first would mean
inventing a cost basis and then replacing it.

## 3. Customer context that should inform judgement calls

- **Goods are often bought for cash at the market with no invoice.** A purchase-order-and-approval
  flow is the wrong primary path. The normal case is: items arrived, this is what I paid, record it.
  Receiving must work with zero paperwork and no supplier selected.
- **Receiving today involves no counting at all** — goods go to the shelf unchecked. The receipt
  screen *is* the counting step being introduced. If entering a 30-line delivery is not mostly
  scanning, it will not be used, and the notebook wins again.
- ~500 products, 3 staff, 50–100 sales/day. **Not a scale problem.** No caching, no background
  jobs, no denormalisation for volume that does not exist.
- Cost and margin are owner-only. Staff must not see them anywhere — not in a response body, not in
  a list endpoint they can call, not in a React prop that merely goes unrendered.
- The prior inventory product was abandoned for inconvenience. Convenience is a correctness
  requirement here, not polish.

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

**Weighted average cost, not FIFO.** Reasoning in architecture §5. FIFO layers, partial consumption
and layer reversal on returns are not worth their complexity until a customer's accountant demands
them.

**Cost is computed by replay over `posting_date`, never maintained incrementally in a trigger.**
Weighted average does not commute: receive 10 at 5, sell 4, then discover a backdated receipt of 10
at 9 — the sale's cost changes. An incremental trigger cannot express that, and M1's migration
comment already records this decision.

**Cost lives behind RLS, not behind Express.** `variant_costs` is admin-only and the admin client
talks to PostgREST directly. Any new cost-bearing table follows the same rule.

**Reservations are never movements.** They land in M2b; nothing in this branch may pre-empt that
design or write a reservation-shaped row into the ledger.

**No bill of materials.** Unchanged from M1.

## 5. The constraint you must resolve before writing any migration

This is the architectural core of the phase, and getting it wrong is expensive.

`stock_movements` is **immutable by trigger** — `BEFORE UPDATE OR DELETE` rejects both. That was
correct and stays. But it collides head-on with replay-based costing:

- An outgoing movement's **consumed cost** is not knowable with certainty at insert time, because a
  backdated receipt posted next week legitimately changes it.
- And it can never be written **afterwards**, because the row cannot be updated.

So the cost of goods sold cannot simply be a column the application fills in later. Two coherent
resolutions exist, and you must choose one explicitly:

**(a) A derived, rebuildable cost table** keyed by movement id, holding the valued cost of each
movement plus the running average after it. The ledger stays the sole record of *what moved*; this
table is the record of *what it was worth*, is wholly derivable from the ledger, and is recomputed
from any date forward when a backdated row appears. `variant_costs.cost_price` becomes a cache of
the latest row in it.

**(b) Value at insert time and correct by compensation** — store the best-known cost on the movement
and, when a backdated receipt invalidates it, post an explicit valuation-correction row. History
stays append-only in the accounting sense, at the cost of a second concept and reports that must
always sum two kinds of rows.

Recommend one with reasoning. State plainly **what is the source of truth for COGS and what is
cache**, and prove the cache is rebuildable: replaying twice from an empty cache must produce
byte-identical results. If you believe there is a third option, argue it.

## 6. What a goods receipt must be

A receipt is a **document that posts movements**. The ledger remains the truth; the document exists
so a human can enter, review and correct a delivery as one unit.

- **Header:** supplier (nullable), `posting_date` (business date, may be backdated — this is why M1
  added the column), free-text reference (invoice number or nothing), note, actor, status.
- **Lines:** variant, quantity, unit cost. A scanned barcode resolves through `variant_barcodes`,
  and `pack_quantity` multiplies — scanning a case of twelve enters twelve, as in M1's adjust flow.
- **Draft vs posted.** A draft touches no stock and may be edited freely. Posting is atomic: every
  line becomes a `goods_receipt` movement carrying `unit_cost`, all sharing one `transaction_id`,
  or nothing is written at all.
- **A posted receipt is immutable**, mirroring the ledger. A mistake is corrected by a reversing
  document, not by editing history. Decide whether a supplier return is a negative line on the same
  document type or its own type, and justify it.
- **Unit cost is mandatory on a receipt line.** A receipt is precisely the moment the number is
  known; permitting zero here is how the margin report becomes a lie.

Open: whether to support freight/customs allocated across lines now. Default position is **a hook,
not a feature** — one nullable header-level additional-cost amount, unallocated and unused, so the
column exists when a customer imports. If you think allocation is cheap enough to build, argue it.

## 7. Weighted-average rules that must hold

- **Deterministic replay order:** `posting_date`, then `created_at`, then `id`. Two movements on the
  same business date must order identically on every replay, forever.
- **Opening balances with unknown cost are excluded from the average, not treated as zero.** The
  first customer's opening balance has no cost basis at all; averaging it in as zero would halve
  every margin he sees in month one and destroy his trust in the number. Exclude, and record that
  the variant's average is based on a partial quantity.
- **Customer returns** re-enter at the average in force at the moment of the original issue when the
  movement references an order, otherwise at the current average. State the rule you implement.
- **Recompute is scoped.** A backdated movement recomputes that variant from that date forward.
  Never a global recompute; never other variants.
- **Negative on-hand** is not possible today (`allow_negative_stock` arrives in §10 defaulting off),
  but define what replay does if it ever encounters it rather than dividing by zero.
- No caching beyond `variant_costs`. 500 variants with short histories is a trivial query; measure
  before optimising anything.

## 8. Suppliers — deliberately thin

Name, optional contact, optional note, active flag. Nullable from a receipt.

**Not** in this phase: addresses, payment terms, currencies, supplier product catalogues, price
lists, lead times, purchase orders, approvals, debt to suppliers. Every one of those is a plausible
next feature and none is asked for. Build the thinnest thing a receipt can point at.

## 9. Margin read — the payoff that justifies the data entry

Owner-only. One screen, a date range, a sortable table. Per variant and per category: units sold,
revenue, COGS, gross margin, margin percent. Plus best and worst contributors by absolute margin,
because "what actually earns money" is the question being asked and a ranked list answers it
directly where a per-row table does not.

No charts, no drill-down, no export, no scheduled digest. Those come when someone asks.

Note the reporting trap from architecture §8: the same item sold loose and sold inside a box must not
be counted twice. No boxes exist yet, so this is a comment in the query, not code — but write the
query so the later distinction has somewhere to go.

## 10. Carried forward from the M1 audits — land them in this branch

Each is small, each was deferred with a reason, and each is cheaper now than after the counter ships.

- **`rebuild_on_hand(variant)` and `verify_stock_integrity()`.** A cached quantity makes divergence
  unlikely, not impossible; both Odoo and ERPNext ship a repair tool for exactly this. Include a
  test that corrupts `on_hand` deliberately and repairs it.
- **`set_product_stock_safe(p_product_id …)` takes a variant id.** The parameter name lies. Split or
  rename it; a function whose name and behaviour disagree is a future outage.
- **Unit of measure becomes immutable once movements exist.** Changing it retroactively reinterprets
  every historical quantity.
- **`allow_negative_stock` as a tenant setting, default off**, each override recorded on the
  movement. Needed before the counter can sell; trivial to add here.

## 11. Open questions — answer in the design note, before any migration

1. COGS source of truth and cache, per §5, with the idempotent-replay proof.
2. Landed cost: hook or allocation.
3. Supplier return: negative line or separate document type.
4. What triggers recompute — a database trigger on movement insert, or an explicit service call
   after posting. Given that replay is expensive relative to an insert and that a receipt posts many
   rows in one transaction, say how you avoid recomputing once per line.
5. Does a draft receipt affect anything a user can observe? (Expected: no — say why, and where that
   is enforced.)
6. Query shape and indexes for the margin report over a date range.
7. Where the cost boundary is tested. Not "does the UI hide it" but "can a staff token retrieve it
   by any route, including PostgREST directly."

## 12. Deliverables, in order

1. **Design note first** at `docs/design-notes/m2a-receiving-cost.md`, answering §11 and proposing
   the schema. Commit it and **stop** — no migrations before it is reviewed.
2. Migrations under `supabase/migrations/`, following existing naming and RLS conventions.
3. Regenerated API layer (OpenAPI → Orval → Zod). Generated files are generated, never hand-edited.
4. API routes: receipt draft/post/reverse, suppliers CRUD, margin report.
5. Admin UI: receipt entry built around scanning, supplier list, margin report. Cost fields absent
   for non-owner roles.
6. Tests per `.agents/rules/testing.md`, including: idempotent replay (property test), atomic
   posting (all lines or none), backdated receipt changing a later movement's valued cost, and a
   staff-token test asserting cost is unreachable.
7. New executable invariants in `scripts/audit/check-invariants.mjs`: no cost field in a
   non-admin response path, and no direct write to `variant_costs` outside the cost module.

## 13. Definition of done

- `pnpm run typecheck` green
- `pnpm run test:unit` green; new tests above present
- `pnpm run audit:invariants:strict` green with an empty baseline
- `main` deployable at every commit on the branch
- Every item in §12 exists, or the design note says why it should not

## 14. Out of scope

Stocktake, reservations and deposits (both M2b). Counter sale, barcode-driven selling, offline queue,
bills of materials, assembly, bundle pricing, locations, lot and expiry tracking, purchase orders
with approval, multi-currency, supplier debt, customer debt, reorder suggestions, dead-stock alerts.

If something here genuinely cannot be built cleanly without one of them, say so in the design note
rather than quietly expanding scope.
