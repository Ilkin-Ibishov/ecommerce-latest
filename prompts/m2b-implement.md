# M2b — implement

The design note is **approved**, and your §7 disagreements are accepted — three of the four are
defects in my work order, not in your reading of it.

- **§7.1 is the important one.** My §4 said each line posts the difference between its counted
  quantity and its own snapshot. With two counters on one variant that is arithmetically broken:
  front shelf 5 (snapshot 12) plus store room 10 (snapshot 12) sums to a delta of −9 where the truth
  is +3, because the snapshot is subtracted once per line. Reconciling every scan of a variant into
  one effective count and taking one delta is correct. Good catch — see §R5 below for the part you
  left open.
- **§7.2** — blind counting belongs in the data layer. Isolating the snapshot table, stripping the
  attributes at the endpoint and adding `no-expected-quantity-on-staff-endpoints` is right. One
  honesty requirement in §R4.
- **§7.3** — "0 ₼ shrinkage" on unvalued stock is exactly the kind of false reassurance that would
  make the owner stop looking at the report. Reporting `unvalued_shrinkage_units` separately is the
  right fix.
- **§7.4** — a store-wide integrity scan inside the posting transaction would let an unrelated
  variant's historical drift abort an honest count. Correct to decouple.

The snapshot trigger, the posting RPC's single-transaction boundary, the role matrix and the single
posted-opening-count index are all sound. Do not refactor them while implementing the below.

Proceed. First commit is the `numRuns` restoration from §9 of the work order, on its own, before any
migration.

---

## R1 — an edited line keeps its original snapshot, and nobody has said so  [must]

The capture trigger is `AFTER INSERT` only, so updating `counted_quantity` leaves the snapshot where
it was. That is the right behaviour for the case it was built for and the wrong one for a case your
RLS explicitly permits: staff may update their own draft lines.

Two different human actions arrive at the same `UPDATE`:

- **A typo fix.** Counted 8, typed 7, corrects it two minutes later. The observation still belongs to
  the original moment, so keeping the first snapshot is correct.
- **A recount.** Wasn't sure, goes back to the shelf an hour later and counts again. The observation
  now belongs to the new moment, and keeping the stale snapshot reintroduces the exact error class
  §4 of the work order exists to prevent — an hour of sales folded into a correction.

Decide the semantics, write them down, and make the interface match:

- An edit means "I mistyped" and keeps the snapshot.
- A recount is a **new observation**: the line is deleted and rescanned, which the trigger gives a
  fresh snapshot by construction.
- The counting screen must make that distinction obvious — a recount must not be reachable by
  quietly editing a number.

Add the test: a line edited after a sale must post the delta against its **original** snapshot, and a
deleted-and-rescanned line against the **new** one.

## R2 — `posting_date` is unconstrained and staff can write it  [must]

`stocktakes.posting_date` is `NOT NULL DEFAULT now()`, and your staff draft-update policy's
`WITH CHECK` constrains `status`, `is_opening_count`, `posted_by`, `posted_at` and `transaction_id` —
but not `posting_date`. So a staff member can set a count's business date to any value, and §1 Q3
answers the replay question only for the default case before asserting that history is preserved.

Work out what a backdated correction actually does, because it is not what either of us assumed. A
correction valued at the prevailing average does **not** change the average, so the unit cost of
later sales is untouched — margins already reported stay as reported. What it does corrupt is the
projection's `running_quantity` history: a correction inserted before sales that have already
happened can drive a historical running quantity negative, which is a statement about the shelf that
was never true. And the apply trigger guards *current* on-hand, not the historical path, so it will
not catch it.

So:

- `posting_date` is owner-writable only. Add it to the staff `WITH CHECK` as unchanged-from-default,
  or keep it off the staff-writable surface entirely.
- It may not be earlier than the latest contributing line snapshot. A count cannot be dated before
  the observation it records.
- State the consequence you found in the notes, replacing the claim in §1 Q3 that history is
  preserved unconditionally.

## R3 — every duplicate needing owner resolution will stall the opening count  [must, your call on shape]

Posting is blocked until each duplicate variant has an explicit resolution. For an ordinary count
that is right. For the opening count — three staff splitting 500 SKUs across a shop and a store room
— duplicates are the normal case, and the owner would face hundreds of identical "yes, add them up"
decisions. That is the friction that killed the last product.

You already carry `location_note`. Use it:

- Contributing lines with **different** location notes default to `sum`, shown as a resolved group
  with every line visible. No owner decision required.
- Lines with the **same** location note are the suspicious case — two people counted the same shelf —
  and those block posting until resolved.
- The owner can always override a defaulted group.

If you think a different shape is better, argue it. What is not acceptable is several hundred forced
clicks on the one count that matters most.

## R4 — say what blind counting cannot do  [must]

Your three mitigations stop the snapshot leaking through the stocktake surface. They do not stop a
staff member reading `product_variants.on_hand` directly through PostgREST, because that column is
readable by design — the admin screens and storefront need it, and restricting it would break them.

So a determined counter can still discover the expected number. Blind counting here means: the honest
counter is not anchored by a number on their screen, and a dishonest one has to go out of their way
and leaves a trace. That is worth having and it is not tamper-proof.

Write that limit into the note and into `.agents/rules/inventory.md` in one line. An invariant check
named `no-expected-quantity-on-staff-endpoints` reads like a closed boundary; the next phase should
not inherit that belief. If you see a way to close it without breaking the storefront, say so rather
than building it.

## R5 — which snapshot the reconciled delta is taken against  [must]

§7.1 says all scans reconcile to "a single snapshot" without saying which. It matters:

Ali counts the front shelf at 14:00, snapshot 12. A unit sells at 14:15. Samir counts the store room
at 14:30, snapshot 11. Reconciled count is 15.

- Against the **latest** snapshot (11): delta +4, post leaves 15. Correct, provided nothing sold after
  14:30.
- Against the **earliest** (12): delta +3, post leaves 14. Wrong by one.

So use the latest contributing snapshot. But notice what the sale at 14:15 means: it may have been
one of the five Ali had already counted, in which case the reconciled 15 is itself stale and no
choice of snapshot fixes it. Multi-area counting of one variant is only exact if no sale of that
variant falls between the first and last contributing scan.

Therefore:

- Reconcile against the **latest** contributing line's snapshot.
- When any movement for that variant has a `created_at` between the earliest and latest contributing
  scan, flag the group in the variance review as possibly stale and name the window. Do not block
  posting; the owner decides whether to recount.
- Test it: two scans straddling a sale must produce the flag, and the single-scan path must not.

## How to work

Commit per logical step. Migrations land before the routes that use them so `main` stays deployable
at every commit. Order the work so the correctness core is provable before any UI sits on it: schema
and snapshot trigger, then reconciliation and `post_stocktake` with their tests, then routes, then
the counting screen, then variance and shrinkage.

The counting screen is the deliverable this phase is judged on. It is a phone, held at a shelf, by
someone who would rather use a notebook. One scan, one number, visible progress, nothing else on the
screen.

## Definition of done

From work order §12, plus the above:

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- `numRuns` back to 200 in its own first commit
- The tests named in R1, R2, R5 and work order §11.6 present
- The new invariant from §7.2 present and passing
- `main` deployable at every commit
- `docs/audits/m2b-implementation-notes.md` written, with the real output of the three commands and a
  plain statement of which test tiers you actually ran

## What you cannot verify, and must not claim

No migration in this repository has ever been executed against a real Postgres, and the CI
integration tier has been failing since July — its repair is postponed deliberately. Your SQL is
checked only by a TypeScript re-implementation of its logic. Write the migrations as if a reviewer
will read them and then run them once, in order, against a live database with no undo. Say in your
notes which tiers ran and which did not.

Do not run migrations against any remote Supabase project.
