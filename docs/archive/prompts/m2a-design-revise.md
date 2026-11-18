# M2a design note — revise. Still no migrations, no application code.

Revise `docs/design-notes/m2a-receiving-cost.md` in place and commit. Do not start implementation.

## What is accepted and must not change

The §5 resolution is correct. Option (a) — a derived, rebuildable `stock_movement_costs` projection
keyed by `movement_id`, with `stock_movements` as the sole immutable record of what physically moved
— is the right call, and the reasoning against compensation rows (zero-delta rows violating
`quantity_delta <> 0`, cascading compensations, fragile reports) is sound. Keep it.

All three items in your §8 are legitimate and two of them are defects in the work order, not in your
reading of it:

- **§8.1** — the spec did contradict itself: cost mandatory on a receipt line, and cost fields hidden
  from staff. Blind draft receiving (staff scan quantities, owner enters costs and posts) resolves it
  correctly. Adopted.
- **§8.2** — `stock_movements.unit_cost` readable by a staff token through PostgREST is a real leak
  that M1 shipped. Finding it is good work. See R5: identifying it is not the same as closing it.
- **§8.3** — the pack-cost / unit-cost hazard is real and the normalisation fix is right. Adopted.

Q2 (landed-cost hook only), Q3 (separate reversal flow, never negative receipt lines), Q4 (explicit
recompute once per distinct variant, never a row trigger) and Q5 (draft observability) are accepted
as answered.

## R1 — `recompute_variant_cost` double-counts the anchor movement  [must]

This is the defect that matters. The partial-recompute path corrupts the running quantity.

```sql
SELECT ..., posting_date INTO ..., v_recompute_from
FROM stock_movement_costs
WHERE variant_id = p_variant_id AND posting_date < p_from_date
ORDER BY posting_date DESC, computed_at DESC LIMIT 1;
...
DELETE FROM stock_movement_costs WHERE variant_id = p_variant_id AND posting_date >= v_recompute_from;
...
WHERE sm.variant_id = p_variant_id AND (v_recompute_from IS NULL OR sm.posting_date >= v_recompute_from)
```

The anchor row carries the state **after** its own movement, and sits at `posting_date =
v_recompute_from`. You then delete every row at or after that date — including the anchor — and
replay every movement from that date forward, starting from the anchor's post-movement state. The
anchor movement is therefore applied twice.

Concretely: a receipt of 10 at 5.00 on 1 Nov, then a backdated receipt posted with
`posting_date = 2 Nov`. The anchor is the 1 Nov row, so `v_qty` starts at 10 and replay re-reads the
1 Nov receipt, ending at 20. `stock_movement_costs.running_quantity` now says 20 while
`product_variants.on_hand` says 20... no: `on_hand` is 20 only because of the second receipt. The
projection and the ledger disagree, and the first `verify_stock_integrity()` run will report a
variant that is in fact fine.

Fix the boundary: anchor on the last row **strictly before** `p_from_date`, then delete and replay
from `p_from_date`, not from the anchor's date. State the three sets explicitly in the note —
carried-forward state, deleted rows, replayed movements — so a reviewer can check they do not
overlap.

**And a second problem in the same query.** The anchor is chosen with
`ORDER BY posting_date DESC, computed_at DESC`, but `computed_at` is the replay timestamp, identical
for every row written in one batch. When several movements share a business date — the normal case,
not an edge case — the anchor is arbitrary. The projection table cannot reproduce its own ordering
key, because it stores `posting_date` but not the `created_at` and movement-`id` tie-breakers the
replay order depends on.

Either store `created_at` on `stock_movement_costs` and anchor by the full
`(posting_date, created_at, movement_id)` order, or anchor by joining back to `stock_movements`. Say
which and why.

Then correct the §2 proof. It proves idempotence for a **full** replay from `S₀` only, and the
partial path is where the bug lives. Prove the partial path too: replaying from any
`p_from_date` must produce the same rows as a full replay. That is the property the implementation
phase will test, so state it as the theorem.

Also drop the claim of byte-identical rows, or exclude `computed_at` from it. A column holding
`now()` is not byte-identical across runs, and an overstated proof hides the real one.

## R2 — the `variant_costs` cache update is a silent no-op  [must]

```sql
UPDATE public.variant_costs SET cost_price = ROUND(v_avg_cost, 2), updated_at = now()
WHERE variant_id = p_variant_id;
```

If no `variant_costs` row exists for that variant, this matches zero rows and the cache is never
written — no error, no warning, and the owner sees a cost of zero or a stale one. `variant_costs` is
keyed by `variant_id` with no guarantee in the schema that a row exists for every variant.

This is the same defect class as M1's G1: a statement that reads like it writes and does not. Use an
upsert, and say in the note what guarantees a row exists for every variant, or stop relying on that.

## R3 — your own blind-draft workflow cannot run under your own RLS  [must]

§8.1 has staff creating a draft receipt and scanning lines into it. Your policies do not allow it:

- `goods_receipts` grants staff `SELECT` only. `FOR ALL USING (public.is_admin())` covers INSERT for
  admin. **Staff cannot create a draft receipt at all.**
- `goods_receipt_lines` grants staff INSERT into a draft, but no UPDATE and no DELETE. A staff member
  who scans a wrong item or mistypes a quantity cannot correct or remove the line.

The second one is not a permissions detail, it is the reason the previous product was abandoned.
Someone counting a 30-line delivery will mis-scan. If the fix is "ask the owner", the receipt screen
is slower than the notebook.

Give staff the policies the workflow needs, scoped to drafts — and state which transitions are
staff-permitted and which are owner-only, as a table. Posting stays owner-only; that part is right.

## R4 — `correlation_id` is not a pointer to a movement  [must]

```sql
SELECT unit_cost INTO v_unit_cost FROM stock_movement_costs WHERE movement_id = v_m.correlation_id;
```

`correlation_id` groups related movements; it is not the primary key of the originating sale. This
lookup will normally find nothing, `COALESCE` will quietly substitute the current average, and the
note will claim returns are valued at their original cost while the code values them at today's.

Decide one of two honest answers and write it down:

- resolve the original issue movement explicitly — via the order reference, or a dedicated column
  that actually names the reversed movement — and value the return at that cost, or
- value every return at the current running average, and say so plainly in the note.

Silently falling back from the first to the second is the one option not available.

There is a second bug in the same branch. When `v_basis_qty <= 0` and the return's unit cost differs
from the average, you add the quantity to the basis without setting the average, so the average stays
at whatever it was — zero, for a variant whose basis was empty. Every subsequent sale is then valued
at zero. Handle the empty-basis case.

## R5 — deprecating `stock_movements.unit_cost` removes the only carrier for opening-balance cost  [must]

Two halves, both missing.

**The leak you found is not closed.** §8.2 says the column is "deprecated", and the three-migration
plan never drops it, never revokes it, and never changes the policy that lets staff read it. A column
described as deprecated in a design note is still a column a staff token can project. Put the fix in
the migration plan — drop it, or restrict it — and add the executable invariant from §12.7 of the
work order: no cost-bearing column on any table a non-admin role can read.

**And opening balances lose their cost basis entirely.** Your Case B tests
`v_m.reason = 'opening_balance' AND v_m.receipt_cost IS NULL`, but `receipt_cost` comes from a join
that only fires for `reason = 'goods_receipt'`. For an opening balance it is *always* NULL, so the
second predicate is dead code and every opening balance is excluded from the average.

For the first customer that is correct — he has no cost basis. But M1 was specified to migrate an
existing tenant **with** meaningful quantities, and after you remove `unit_cost` from the ledger
there is no table anywhere that can hold what that stock cost. Propose a carrier, or state as a
decision that opening balances are always unvalued and that an existing tenant's cost basis begins
at its first priced receipt. Either is defensible. Silence is not.

## R6 — the margin report mixes two time axes  [must]

COGS is filtered on `sm.posting_date`; revenue is filtered on `o.created_at`. An order created on
31 October whose stock movement posts on 1 November contributes revenue to one month and cost to the
other. Every month boundary then shows a margin that is wrong in both directions, and this is the one
number the owner is being asked to trust.

Pick a single axis — the sale movement's `posting_date` is the better one, because it is the same
axis the valuation is computed on — and derive revenue through the movement's order linkage rather
than by querying orders independently.

While you are there: the `CASE WHEN reason IN ('online_sale','counter_sale') THEN -quantity_delta
ELSE -quantity_delta END` has two identical branches; and a counter sale in M3 will have no
`order_items` row at all, so revenue will be zero against a real COGS. Note how the shape survives
that. Also confirm `'refused_at_delivery'` is an actual `order_status` value — if it is not, the
query does not run.

## R7 — `rebuild_on_hand` and `verify_stock_integrity` are listed but never designed  [must]

Migration 2 deploys both. The note never gives either a signature, a semantics, or a failure mode.
They are repair tools for a cached quantity, which makes them the most dangerous functions in the
schema: one of them writes `on_hand` directly, which M1 forbade by trigger.

Specify both. For `rebuild_on_hand`: how it writes a guarded column, whether it writes a
compensating movement instead of touching `on_hand`, who may call it, and what it does under
concurrent sales. For `verify_stock_integrity`: what it returns, and whether it reports the
ledger-versus-`on_hand` divergence only or also the projection-versus-ledger divergence that R1
would have produced.

## Minor — fix, no argument needed

- `reference_type = 'purchase_order'` for a goods-receipt movement. There are no purchase orders in
  this product. Add an honest value to the CHECK constraint. Keep `reference_id` pointing at the
  line, since the replay join needs it, but make the type name say so.
- Say explicitly whether `additional_costs` is readable by staff on `goods_receipts`. Your comment
  says "visible only to admin via view or restricted to admin" — decide which.

## When you are done

Commit the revised note. Still no migrations. The next gate is implementation, and the note is what
will be held against the code.
