# Launch prompt — M2a audit

Act as the `auditor` agent defined in `.agents/agents/auditor.md`. Read that file first and follow
it exactly, including the rule that you fix nothing.

## Your inputs

- Spec: `docs/tasks/warehouse-m2a-receiving-cost.md`
- Invariants: `.agents/rules/inventory.md`
- Branch under review: `m2/receiving-cost`
- Diff: `git diff main...m2/receiving-cost`
- Mechanical checks: `pnpm run typecheck`, `pnpm run test:unit`,
  `pnpm run audit:invariants:strict`

**Do not read `docs/design-notes/m2a-receiving-cost.md` or `docs/audits/m2a-implementation-notes.md`.**
Both contain the implementer's reasoning. This review exists to catch what that reasoning missed,
and you cannot do that from inside it.

Already known, so finding them again is worth nothing: `storefront-ux.property.test.ts` Property 3
times out under suite load and passes alone — a pre-existing flaky timeout, not this branch's work.

## What this phase is

M1 made quantities true: stock lives on variants and changes only through immutable rows in
`stock_movements`. M2a adds what those quantities **cost** — goods receipts, suppliers,
weighted-average cost, and a margin report — while the ledger stays immutable. Cost of goods sold is
therefore a *derived projection* recomputed by replaying movements in business-date order, not a
value written onto a movement.

The owner sees cost and margin. The three staff must not, anywhere, by any route.

## What to hunt for in this particular phase

These are the failure modes this design is most exposed to. One of them found with a concrete
sequence is worth more than twenty style observations.

1. **The projection disagreeing with the ledger.** The replay is scoped: a backdated movement
   recomputes one variant from one date forward. Construct a sequence — interleaved receipts, sales,
   returns, a backdated receipt, a reversal — where the projection's running quantity or running
   average ends up different from what a full replay from zero would produce. Partial replay must
   equal full replay for every input. Look hardest at the boundary: rows retained, rows deleted,
   movements replayed, and what happens when several movements share one `posting_date` or one
   business date straddles the cutoff.
2. **A cost path that reaches a staff token.** Not "does the screen hide it" — can a staff JWT read
   cost or margin through PostgREST directly, through a generic list endpoint, through a generated
   client hook returning more fields than the UI renders, through an RPC's return type, or through an
   error message? RLS governs rows, not columns: any cost column on a table a staff token may read is
   a leak even if no code selects it.
3. **Non-atomic posting.** A receipt must post every line or none. Find the sequence — a failing
   line, a constraint violation, a trigger raise, a lost connection mid-post — that leaves movements
   written with the receipt still in draft, or a receipt marked posted with movements missing.
4. **Posting the same receipt twice.** Two concurrent posts of one draft, or a retried HTTP call.
   Does the quantity double? Is the status transition actually guarded by a lock, or only by a read
   of `status` followed later by a write?
5. **Reversal.** A reversed receipt must leave on-hand and valuation exactly as if it had never been
   posted — except where real sales consumed the goods in between. Construct the case where reversal
   leaves a wrong average, a negative basis, or stock that was already sold.
6. **The repair functions.** `rebuild_on_hand` writes a column M1 guarded by trigger, through a
   transaction-scoped setting. Can anything other than that function turn the setting on? Can a staff
   token call either function? What happens to a concurrent sale posted while a rebuild is running?
   And does `verify_stock_integrity` actually detect the divergences it claims — including the
   projection-versus-ledger one, not only ledger-versus-`on_hand`?
7. **Margin arithmetic that is wrong rather than merely imprecise.** Revenue and COGS must sit on
   one time axis and one granularity. Construct the case the report gets wrong: a partial return of a
   multi-unit line, an order with two lines of the same variant, a discounted line, a cancelled order,
   a write-off, a sale whose variant has no cost basis yet. Then check the rounding: does a per-unit
   cost rounded to two decimals, multiplied back out, drift from the total it was derived from?
8. **Opening balances with no known cost.** They must be excluded from the average, not averaged as
   zero. Find the path where an unvalued opening balance still drags an average down, or where a
   variant with only an unvalued opening balance reports a margin as if its cost were zero.
9. **Reservations.** None exist yet and none may be implied. Check nothing in the new schema or code
   treats a promise to a customer as a change in what is physically present.
10. **Migration correctness on both paths.** Applied to a database with existing movements, and to
    an empty one. Dropping a column, backfilling a projection, adding a NOT NULL — does either path
    leave a tenant with wrong valuations, or fail outright? Does the backfill produce the same result
    as running the engine from scratch afterwards?
11. **Silenced tests.** Diff the test files specifically. Was anything deleted, skipped, given a
    looser assertion, or given a longer timeout to make the suite pass? A property test whose run
    count was lowered is a weakened test.
12. **Generated code edited by hand.** The API layer comes from `openapi.yaml` through codegen. If a
    generated file changed without the spec changing in the same commit, say so.

## Output

Write `docs/audits/m2a-receiving-cost-audit.md` in the format given in `.agents/agents/auditor.md`,
commit only that file, and stop.

Every finding needs a concrete failing scenario — specific inputs or a sequence of events, and the
wrong outcome they produce. A finding without one is an opinion and I will discard it. Rank by
severity, and say plainly which findings are theoretical given one shop with three staff and 500
products, and which will bite in the first month of real use.

If the implementation holds up, say so and list what you checked. An honest short report beats a
padded one.
