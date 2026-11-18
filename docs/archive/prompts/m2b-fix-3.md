# M2b — fixes after the adversarial audit

`docs/audits/m2b-stocktake-audit.md` is the audit. I verified every finding against the code myself
and all six are real. Five of them exist because **my earlier instructions were precise but
incomplete** — that is my error, not yours, and the notes should say so where relevant.

**These instructions are prescriptive. Implement them as written. Do not choose an alternative
design, do not refactor anything they do not touch.** If you believe one is wrong, implement it and
say so in your notes.

One commit per item, in order F1 … F7.

Two things I checked and found sound, so leave them alone: the redefinition of `post_stocktake` in
`20261104150000_m2b_resolution_staleness.sql` is complete (cost recompute, status update and
privileges all carried over), and `POST /admin/stocktakes/:id/opening-costs` is correctly
`requireAdmin`.

---

## F1 — every stocktake is unpostable  [blocker]

`stocktakes.posting_date` defaults to `now()` when the draft is **created**. Lines are scanned
afterwards, so their snapshots always have a later `captured_at`, so the guard I asked for in R2
always fires: `ST010` on every posting through the normal flow. The feature is 100% unusable today.

My R2 instruction was written against backdating abuse and ignored that the normal flow sets the date
before any line exists. The business date of a count is when it was **counted**, not when someone
opened the draft.

Fix, exactly:

1. New migration `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql`:
   drop the default on `public.stocktakes.posting_date` and make the column **nullable**.
2. In `post_stocktake` (redefine it in that same new migration, carrying the current body over
   unchanged except for these points):
   - `v_effective_posting timestamptz := COALESCE(v_st.posting_date, now());`
   - run the `ST010` guard **only** when `v_st.posting_date IS NOT NULL` — an explicitly chosen
     business date may not precede an observation; an unset one cannot
   - write movements with `v_effective_posting`, and pass it to `recompute_variant_cost`
   - in step 8, also set `posting_date = v_effective_posting` so the posted document records the
     business date it actually used
3. The create route already writes `posting_date` only when an owner supplies it. Leave it.

Tests: the ordinary flow — create with no `posting_date`, scan a line, post — must succeed and the
movements must carry the posting moment. An owner-supplied `posting_date` earlier than a line's
snapshot must still raise `ST010`.

## F2 — an override is measured against the wrong snapshot  [blocker]

The lateral join always takes the latest contributing line's snapshot. When the owner resolves with
`override` and picks the **earlier** line, the counted quantity comes from that line while the
snapshot comes from a different, later one — so sales between the two scans are erased.

A count and the snapshot it is measured against must come from the **same observation**.

Fix: in the `reconciled` CTE, select the snapshot by resolution type:

- `override` → the snapshot of `sr.chosen_line_id` (the column is already stored by the resolution
  route). If `chosen_line_id` is NULL on an override, raise with `ERRCODE = 'ST013'` naming the
  variant — an override without a chosen line is not resolvable.
- `sum`, and the unresolved default → the snapshot of the latest contributing line, as now.

Tests: the audit's sequence (count 10 at 10:00, two units sold, rescan 6 at 12:00, override to
line 1) must leave on-hand at 8, not 10. And a `sum` resolution must keep using the latest snapshot.

## F3 — the variance screen contradicts what posting will do  [blocker]

`artifacts/api-server/src/lib/stocktake-variance.ts`:

```ts
const varianceQty = stocktake.is_opening_count
  ? countedQuantity
  : Number((countedQuantity - snapshotOnHand).toFixed(3));
```

A1 removed that branch from the SQL but not from the TypeScript twin, so for an opening count the
review shows the counted quantity as the variance while posting applies `counted − snapshot`. A
variant with a legacy balance of 10 counted at 4 shows **+4 and zero shrinkage** on screen and posts
**−6**. The owner approves one number and another is applied — the exact failure fix-1 closed in this
same file.

Fix: delete the branch. `varianceQty` is always `counted − snapshot`.

Test: opening count, legacy on-hand 10 at cost 20, counted 4 → variance −6, `shrinkage_value` 120,
and the posted movement is −6. Assert the screen figure and the movement agree.

## F4 — the staleness check cannot see an edited line  [must]

`resolved_latest_line_at` is compared against `MAX(created_at)`, and a typo fix changes
`counted_quantity` and `updated_at` while leaving `created_at` alone. So an owner can resolve a
conflict, a counter can then change 5 to 50, and posting silently uses the stale resolved quantity.

This is my A4 mechanism being blind to my own R1 decision that an edit keeps its line. The two
interact and I did not connect them.

Fix: compare the latest line **change**, not the latest line creation.

- The resolution route stores `resolved_latest_line_at = MAX(GREATEST(created_at, updated_at))` over
  that variant's lines.
- The guard in `post_stocktake` compares against the same expression.
- Keep the column name; only what it holds changes. No new column.

Test: the audit's sequence — resolve at 10:10, edit a line at 10:15 — must raise `ST011`; re-resolving
then posts the corrected quantity.

## F5 — staff can mutate a posted stocktake  [must]

`routes/admin/stocktake-lines.ts` checks only that a staff member owns the line. It never checks the
parent stocktake's status, and the route uses the service-role client, so RLS does not stop it.
Deleting a line of a **posted** stocktake cascades its snapshot away and corrupts the audit trail.
`DELETE /admin/stocktakes/:id` is likewise reachable by a staff token.

Fix:

- `PATCH` and `DELETE` on `/admin/stocktakes/:id/lines/:lineId`: load the parent stocktake's status
  first and reject anything other than `draft` with 400 and a message naming the status. Keep the
  existing ownership check for staff.
- `DELETE /admin/stocktakes/:id`: require `requireAdmin`.
- Add an executable invariant in `scripts/audit/check-invariants.mjs`: a route handler that mutates
  `stocktake_lines` or `stocktakes` through the service-role client must reference a status check.
  Name it `stocktake-mutations-check-draft-status`. If you cannot express that reliably as a static
  check, say so in your notes and skip it rather than writing something that passes vacuously.

Tests: a staff token patching and deleting a line on a posted stocktake gets 400; on a draft it
succeeds; a staff token deleting a stocktake gets 403.

## F6 — a negative opening balance can make cost replay divide by zero  [must]

In `recompute_variant_cost` (`20261104110000_m2a_functions_triggers.sql`), the `opening_balance`
branch assigns `v_basis_qty := v_m.quantity_delta` when the basis is at or below zero. After F1's
arithmetic an opening count can legitimately post a **negative** `opening_balance`, which sets the
basis negative; a later receipt of the same magnitude then divides by `(-6) + 6 = 0` and aborts, which
permanently blocks receiving for that variant.

This is the question I asked you in the A1 prompt — what a negative `opening_balance` means to the
replay — and neither of us answered it.

Fix, in a new migration `supabase/migrations/20261104170000_m2a_replay_negative_basis.sql` that
redefines `recompute_variant_cost`, carrying the current body over unchanged except:

- the `opening_balance` branch clamps the basis: `v_basis_qty := GREATEST(0, v_basis_qty + v_m.quantity_delta)`
- the inbound-receipt branch guards its denominator: when `v_basis_qty + v_m.quantity_delta <= 0`,
  treat the receipt as a fresh basis — `v_avg_cost := v_unit_cost` and
  `v_basis_qty := GREATEST(0, v_m.quantity_delta)` — instead of dividing

Test: the audit's exact sequence — legacy unvalued 10, opening count to 4, then a receipt of 6 at 30 —
must post the receipt without error and leave a sane average.

## F7 — two conditions share one error code  [must]

`ST010` is raised both for the `posting_date` guard and for the missing-snapshot guard. My
instruction claimed `ST010` was unused; it was already taken. Two causes behind one code cannot be
told apart by a caller.

Fix: the missing-snapshot guard becomes `ST012`. Leave the `posting_date` guard on `ST010`. Update
any test that asserts the old code.

---

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- Every test named under F1 … F6 present and passing
- `docs/audits/m2b-fix-3-notes.md` written: what changed per finding, anything you believe is wrong
  in these instructions, and the real output of the three commands

Do not run migrations against any remote Supabase project. Regenerate the API layer through codegen
if `openapi.yaml` changes; never edit generated files by hand.
