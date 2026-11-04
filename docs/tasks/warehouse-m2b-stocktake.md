# M2b — Stocktake, the Opening Count, and Shrinkage

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants: `.agents/rules/inventory.md`. Architecture: `docs/tasks/warehouse-architecture.md`.
Current state: `docs/STATUS.md`. The costing engine this phase values corrections with:
`docs/design-notes/m2a-receiving-cost.md`.

## 1. Why this exists, and why it is the gate to go-live

Everything built so far assumes the system knows how much of something exists. **For this customer it
does not, and never has.** Nothing has been tracked, the last physical count was a year ago, and
every variant currently sits at zero or at a migrated number that means nothing.

So this phase is not a reporting feature. It is **how real data enters the product for the first
time**, and it is the last thing standing between the build and a shop that actually uses it. Until a
count exists, the margin report from M2a has quantities it cannot trust, and M3's counter cannot sell
from a number that was never true.

It is also the first thing the owner can judge with his own eyes: he walks the shelves, types what he
sees, and the system tells him what it thought and what that gap is worth. That is the moment the
product either earns his trust or loses it.

## 2. Phase scope — stocktake only

**In:** counting (including the opening count), variance review, posting corrections, valuing them
through M2a's engine, and a shrinkage figure.

**Out, and specified separately as M2c:** reservations and deposits. They touch the storefront's
availability path, which is a different risk surface and deserves its own narrow diff. Nothing here
may pre-empt that design — no reservation table, no reservation-shaped column, and no movement that
represents a promise rather than a physical change.

## 3. Customer context that should inform judgement calls

- ~500 SKUs, 3 staff, one shop with an adjacent store room, 50–100 sales/day.
- **The shop stays open while counting.** A 500-SKU count takes hours, possibly spread over days.
  Any design that requires the shop to stop selling is not a design, it is a wish.
- Counting will be done on a phone, standing at a shelf, by a staff member, using a barcode scanner.
  If a line takes more than a scan and a number, it will not get done for 500 SKUs.
- The owner named **inability to detect theft** as one of his top pains. A count is the only
  instrument that detects it. This shapes who may see what — see §5.
- The previous inventory product was abandoned for inconvenience. A count that has to be restarted
  because something sold mid-count will be abandoned on day one.

## 4. The invariant this phase turns on

> **A count is an observation at a moment in time, not a command to set a number.**

Posting `on_hand = 7` at 18:00 for a shelf counted at 14:32 erases every sale in between. With 500
SKUs counted over hours while the shop trades, that is not an edge case — it is the normal case, and
it would silently destroy the correct numbers the ledger worked to earn.

Therefore each count line records three things: **the counted quantity**, **the system's on-hand at
the instant the line was entered** (read by the system, never typed by a human), and **when that was**.
The correction posted is the difference between them, applied as a delta. Sales that happen
afterwards land on top and stay intact.

**I am revising my own earlier position here.** The M1 audits carried forward a note proposing
optimistic concurrency — accept the observed quantity and reject the line on mismatch. That is wrong
for this shop. The SKUs that move during a count are exactly the fast sellers whose numbers matter
most, and rejection means a recount, which in practice means the count never finishes. The delta
composes correctly and needs no rejection; keep a mismatch *warning* for the reviewer, not a block.

State in the design note what residual error remains (it is the seconds between the human's eyes and
the system read) and why that is acceptable where hours are not.

## 5. Blind counting, and why it is a security feature

The person counting must **not** see the expected quantity. If the screen shows "system says 12", the
path of least resistance is to type 12, and the count becomes a transcription of the system's own
belief — worthless as evidence, and worthless for the one pain the owner named.

- Staff entering counts see: the product, the variant, and a field for what they counted.
- The owner reviewing variance sees: counted, expected, difference, and what the difference is worth.
- Cost and value stay owner-only, as established in M2a.

If you believe there is a case for showing staff the expected number, argue it in the design note
rather than quietly deciding it in the UI.

## 6. The opening count is a different thing wearing the same clothes

The first count is not a correction of a previous belief — there is no previous belief. It **is** the
opening balance, and M2a already built the carrier for its cost (`variant_costs.opening_cost`, which
is admin-only and excluded from the running average when NULL).

So a stocktake marked as the opening count posts `opening_balance` movements, not
`stocktake_correction` ones. This is not cosmetic: the reason code is what keeps an unvalued opening
quantity out of the weighted average, and what stops the margin report treating day-one stock as
goods received at zero cost.

Design the opening count as a mode of the same document, not a separate subsystem. Decide and justify:

- whether the owner can enter a cost per line during the opening count (filling `opening_cost`), and
  what happens to the lines where he does not know
- what happens to a variant that is never counted — is it zero, or is it unknown, and can the two be
  distinguished later
- whether a second "opening count" is permitted once the first has posted, and what it means

## 7. Counting while trading, and three staff at once

- A count is a document with lines, saved progressively. Closing the browser must not lose two hours
  of work.
- Partial counts are first-class: a count may cover a category, a shelf, or a list of SKUs, and the
  variants it does not cover are untouched. Only the opening count is expected to cover everything.
- Three people may count different parts of the same stocktake at the same time. Decide whether a
  line is owned by its counter, what happens when two people count the same variant, and how that is
  surfaced to the reviewer — do not silently keep the last write.
- A posted stocktake is immutable, like a receipt. A mistake is corrected by another count, not by
  editing history.

## 8. What the owner gets out of it

One screen, owner-only, for a posted stocktake:

- lines where counted and expected differ, sorted by the **value** of the difference, not its size —
  one missing gold-plated thing matters more than forty missing ribbons
- the total value of negative corrections for the period: **shrinkage**, in manat
- a count of variants not covered by the count

No charts, no trend lines, no per-staff accuracy scoring. Shrinkage valued at weighted-average cost
through M2a's engine is the number he has never had and will act on.

## 9. Carried forward

- **Restore `numRuns` to 200** in `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
  Property 3, keeping the 15s timeout. The timeout alone fixed the flake; halving the run count
  weakened a property test for no reason. First commit on this branch, on its own.
- `verify_stock_integrity()` gained a projection-versus-ledger check in M2a. A posted stocktake is a
  natural moment to run it. Decide whether posting calls it, or whether that couples two concerns.

## 10. Open questions — answer in the design note, before any migration

1. Where the system's on-hand snapshot per line is captured and stored, and how you guarantee it was
   read by the system rather than supplied by the client. A client-supplied expected quantity is a
   client-supplied correction.
2. Posting atomicity across potentially 500 lines, and whether a 500-line post needs batching. Say
   what happens if line 300 fails.
3. How the correction's cost basis is obtained for a **found** unit (it has no receipt) and for a
   **lost** unit, and where that interacts with M2a's replay. A found unit posted with a
   `posting_date` in the past re-runs the replay — say what that does to margins already reported.
4. Concurrent counting by three staff: ownership, duplicate lines, conflict surfacing.
5. Whether a stocktake reserves or freezes anything. (Expected: no. Say why, and where that is
   enforced.)
6. The variance query shape and its indexes.
7. Role matrix: who creates, who enters lines, who reviews, who posts, who sees value. Posting a
   correction changes stock, so it is not a staff action — confirm or challenge that.

## 11. Deliverables, in order

1. **Design note first** at `docs/design-notes/m2b-stocktake.md`, answering §10 and proposing the
   schema. Commit it and **stop** — no migrations before it is reviewed.
2. Migrations under `supabase/migrations/`, following existing naming and RLS conventions.
3. Regenerated API layer (OpenAPI → Orval → Zod). Generated files are generated, never hand-edited.
4. API routes: create/list a stocktake, enter and amend lines, post, variance and shrinkage read.
5. Admin UI: a phone-first counting screen built around the scanner, blind to expected quantities;
   an owner variance review; the shrinkage figure. The counting screen is the one that decides
   whether this product gets used — treat it as the primary deliverable, not the last one.
6. Tests: a count posted hours after entry must preserve interleaved sales; blind-count data never
   reaching a staff response; atomic posting; the opening-count path producing `opening_balance`
   movements; found and lost units valued correctly; concurrent line entry.
7. New executable invariants where a rule can be mechanised — in particular that no endpoint returns
   an expected quantity to a non-owner role while a count is open.

## 12. Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- `main` deployable at every commit on this branch
- Every item in §11 exists, or the design note says why it should not
- `docs/audits/m2b-implementation-notes.md` written, with the real output of the three commands

## 13. Out of scope

Reservations and deposits (M2c). Counter sale, barcode selling, offline queue (M3). Cycle-count
scheduling, ABC analysis, count-sheet printing, per-staff accuracy scoring, stock-ageing and
dead-stock reports, locations and bin-level counting, lot and expiry tracking, reorder suggestions.

If something here genuinely cannot be built cleanly without one of them, say so in the design note
rather than quietly expanding scope.

## 14. One thing that is not verified, and that you must not paper over

No migration from M1 or M2a has ever been executed against a real Postgres. The CI integration tier
has been failing since July and its repair is deliberately postponed, so the SQL in this repository
is checked only by a TypeScript re-implementation of its logic.

Write your migrations as if they will be read by a reviewer and then run for the first time in one go
against a live database with no undo. Keep each one independently applicable, say in your notes what
order they must run in, and do not assume an earlier migration's object exists without checking.
