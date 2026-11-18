# Launch prompt — M2b audit

Act as the `auditor` agent defined in `.agents/agents/auditor.md`. Read that file first and follow
it exactly, including the rule that you fix nothing.

## Your inputs

- Spec: `docs/tasks/warehouse-m2b-stocktake.md`
- Invariants: `.agents/rules/inventory.md`
- Branch under review: `m2b/stocktake`
- Diff: `git diff main...m2b/stocktake`
- Mechanical checks: `pnpm run typecheck`, `pnpm run test:unit`,
  `pnpm run audit:invariants:strict`

**Do not read `docs/design-notes/m2b-stocktake.md`, `docs/audits/m2b-implementation-notes.md`, or
`prompts/m2b-implement.md`.** They contain the implementer's reasoning and my review of it. This
audit exists to catch what both of us missed, and you cannot do that from inside either.

Already known, so finding them again is worth nothing: the `storefront-ux.property.test.ts`
Property 3 flake is fixed; blind counting is deliberately not tamper-proof against a staff token
reading `product_variants.on_hand` directly, and that limit is recorded in
`.agents/rules/inventory.md`.

## What this phase is

M1 made quantities change only through an immutable ledger. M2a added what they cost. M2b is how a
**true** quantity enters the system for the first time: a physical count, done on a phone by three
staff, over hours, while the shop keeps selling, with the counter deliberately not shown what the
system expects.

The arithmetic is the whole phase. A count line stores what was counted; the system separately
records what it believed at the instant that line was inserted; posting writes the difference as a
delta so that sales during the count survive. Several scans of one variant reconcile into one
effective count before a single delta is taken.

## What to hunt for in this particular phase

One of these found with a concrete sequence is worth more than twenty style observations.

1. **A sale lost or double-counted across a count.** This is the defect the phase exists to prevent,
   so attack it hardest. Construct timed sequences — scan, sale, edit, sale, rescan, post — where the
   posted correction erases a real sale, or applies one twice. Pay attention to which snapshot a
   reconciled multi-scan variant is measured against, and to what an edited line versus a deleted and
   rescanned line does to that snapshot.
2. **Reconciliation arithmetic.** Two counters, three counters, the same variant twice by one person,
   a zero count, a count of a variant with no prior movements, a variant counted in one area and
   missed in another. Does any combination subtract a snapshot more than once, or sum quantities that
   should have overridden each other?
3. **The counted-but-not-posted window.** A stocktake sits in draft for two days while trading
   continues. What does posting then do? Is there any input — a date, a snapshot, a resolution — that
   is stale in a way the code does not notice?
4. **Blind counting through an unexpected door.** Not `product_variants.on_hand`, which is known and
   accepted. Any *other* route by which a staff token learns the expected quantity: a variance
   endpoint missing its role check, an error message that leaks a number, a list endpoint that
   embeds a snapshot, a generated client hook returning more than the screen shows, an RPC return
   type, a count of rows that reveals the answer.
5. **Posting atomicity and double posting.** 500 lines, one failure in the middle. Two concurrent
   posts of one stocktake. A retried HTTP call. Does stock double, or a status change without its
   movements?
6. **The opening count.** It posts a different reason code and may carry costs. Find the case where
   an opening count produces a wrong average, values stock it should have left unvalued, or lets a
   second opening count through. Check the single-posted-opening-count index actually does what its
   name claims.
7. **Cost of corrections, and the replay it triggers.** A found unit and a lost unit both need a
   basis from M2a's engine. Construct the case where a correction changes a margin that was already
   reported, or leaves the projection's running quantity disagreeing with the ledger — including when
   the stocktake's business date is not today.
8. **Negative and zero edges.** A correction that would drive on-hand below zero with
   `allow_negative_stock` off. A variant whose on-hand is zero and whose count is zero. A count of a
   variant that was deleted or whose unit of measure changed mid-count.
9. **Role boundaries.** Who can create, enter, edit, delete, resolve, post, and see value. Check the
   RLS policies rather than the comments claiming they exist, and check what the Express routes do
   with the service-role client — M2a shipped a blocker in exactly that seam.
10. **Reservations.** None may exist or be implied. No table, column, reason code or query may treat
    a promise to a customer as a physical change.
11. **Silenced tests.** Diff the test files specifically. Anything deleted, skipped, assertions
    loosened, timeouts raised, property run counts lowered?
12. **Generated code edited by hand.** The API layer comes from `openapi.yaml` through codegen. A
    generated file changed without the spec changing in the same commit is a finding.

## Output

Write `docs/audits/m2b-stocktake-audit.md` in the format given in `.agents/agents/auditor.md`,
commit only that file, and stop.

Every finding needs a concrete failing scenario — specific inputs or a timed sequence of events, and
the wrong outcome it produces. A finding without one is an opinion and I will discard it. Rank by
severity and say plainly which findings are theoretical for one shop with three staff and 500
products, and which will bite during the first real count.

If the implementation holds up, say so and list what you checked. An honest short report beats a
padded one.

---

## Operating constraints for this run (added after a failed first attempt)

**Work directly. Do not spawn subagents or parallel research tasks.** The first attempt at this audit
fanned out into subagents, hit rate limits, and died without producing a report. Read the files
yourself, in sequence, and write the findings.

**Already fixed, so finding them again is worth nothing:**

- The variance service fetched the entire `stocktake_line_snapshots` table unscoped and fell back to
  the variant's current on-hand when a snapshot was missing. Both are fixed: the query is scoped by
  `line_id` and a missing snapshot now throws.
- The opening count posted the counted quantity as the delta while M1's migration had left on-hand
  non-zero. Fixed: both branches now compute `effective_counted - effective_snapshot`.
- `CROSS JOIN LATERAL` silently dropped a variant whose snapshot was missing. Fixed: `LEFT JOIN
  LATERAL` plus an explicit raise.
- A variant counted at zero could not clear a non-zero quantity. Fixed as a consequence of the above,
  with tests.
- A multi-counter resolution could go stale when a later scan arrived. Fixed: `resolved_line_count`
  and `resolved_latest_line_at` on `stocktake_resolutions`, checked before posting.

Note that `post_stocktake` is **redefined** in `supabase/migrations/20261104150000_m2b_resolution_staleness.sql`.
That file, not the earlier functions migration, holds the live version of the function. Audit the
live one.

Mechanical state as of this run, verified: `pnpm run typecheck` exit 0, `pnpm run test:unit` 608
tests in 49 files all passing, `pnpm run audit:invariants:strict` 9 checks with 0 violations and an
empty baseline. You do not need to re-establish those; spend your budget on finding what they do not
cover.
