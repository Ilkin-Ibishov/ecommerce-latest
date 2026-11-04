# M2b — four defects in the posting arithmetic

From my own adversarial pass over `post_stocktake`. The audit run died on a model quota, so these are
not in any audit file.

**These instructions are prescriptive. Do not choose an alternative approach, do not redesign
anything, and do not refactor code these four defects do not touch.** If you believe an instruction
here is wrong, implement it as written and say so in your notes — do not silently substitute your own
design. Every file and line reference below has been verified against the current branch.

One commit per defect, in order A1, A2, A3, A4.

---

## A1 — the opening count adds to the legacy number instead of replacing it  [blocker]

### Where

`supabase/migrations/20261104140000_m2b_stocktake_functions.sql`, the `variant_deltas` CTE inside
`post_stocktake`:

```sql
CASE
  WHEN v_st.is_opening_count THEN effective_counted
  ELSE (effective_counted - effective_snapshot)
END AS delta
```

### Why it is wrong

The opening-count branch posts the counted quantity as the delta. That is correct only if on-hand is
zero when the opening count posts. It is not zero.

`supabase/migrations/20261102100000_m1_variants_ledger.sql`, from line 236: the migration creates
each variant with `on_hand = 0` and then, when the legacy `products.stock` was greater than zero,
posts an `opening_balance` movement for that amount. The apply trigger adds it. So every migrated
product has a non-zero on-hand today.

The failing sequence:

1. Legacy `products.stock` = 5, so the migration posted `opening_balance` +5 and `on_hand` = 5
2. The opening count finds 7 on the shelf; the snapshot trigger records 5
3. Posting writes delta **+7**
4. `on_hand` = 12 — neither the legacy fiction nor the counted truth

Across ~500 migrated products every one with a legacy quantity is wrong by exactly that quantity, and
the owner meets the error immediately after hours of counting.

### What to change

Delete the `is_opening_count` special case from the delta arithmetic. **Both** cases compute
`effective_counted - effective_snapshot`, so the CTE becomes a single expression:

```sql
(effective_counted - effective_snapshot) AS delta
```

Keep the reason-code conditional exactly as it is — an opening count still posts `opening_balance`,
an ordinary count still posts `stocktake_correction`. Only the arithmetic changes.

Add a comment above the INSERT stating that an `opening_balance` movement may be negative, because an
opening count establishes the true quantity over a migrated placeholder, and that the sum of a
variant's `opening_balance` movements is its established opening quantity.

Do not reverse the migration's movement, do not add a second movement, and do not refuse to post when
on-hand is non-zero. One movement per variant, delta to truth.

### Tests (all four required)

Add them to the existing M2b test file rather than creating a new one:

1. legacy opening balance 5, counted 7, opening count → `on_hand` ends at exactly 7
2. legacy opening balance 0 (no prior movements), counted 7, opening count → ends at 7
3. legacy opening balance 5, counted 5, opening count → ends at 5 and **no movement is written**
   (the zero delta is filtered, which is correct here)
4. ordinary count, snapshot 5, counted 7 → ends at 7 with reason `stocktake_correction`

## A2 — a line with no snapshot is silently dropped from the posting  [must]

### Where

Same CTE, the lateral join:

```sql
CROSS JOIN LATERAL (
  SELECT stls.snapshot_on_hand
  FROM public.stocktake_lines stl
  JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
  WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
  ORDER BY stl.created_at DESC
  LIMIT 1
) latest_snap
```

### Why it is wrong

`CROSS JOIN LATERAL` drops the outer row when the subquery returns no rows. A variant whose lines
have no snapshot therefore receives **no correction at all** — no error raised, nothing in the
response saying a variant was skipped. The owner approves a variance list and posting silently
applies fewer corrections than he approved.

The snapshot trigger writes exactly one row per line, so a missing snapshot means a broken invariant.
Posting must stop, not continue with a shorter list.

### What to change

Change `CROSS JOIN LATERAL` to `LEFT JOIN LATERAL`. Before the INSERT, add an explicit check: if any
reconciled row has a NULL `effective_snapshot`, raise

```
'Cannot post stocktake %: variant % has count lines with no system snapshot'
```

with `ERRCODE = 'ST010'`. `ST010` is unused in this schema; use it.

### Test

A stocktake with two lines; delete one line's row from `stocktake_line_snapshots`; assert posting
raises `ST010` and that **no** movements were written for either variant.

## A3 — a counted-zero line must be able to clear a non-zero quantity  [must]

### Where

Same INSERT: `WHERE vd.delta <> 0;`

### Why this needs a test rather than a change

The filter itself is correct — `stock_movements` has `CHECK (quantity_delta <> 0)`. The bug was A1:
with the opening-count branch posting `effective_counted`, a variant counted at zero produced a zero
delta and its legacy quantity survived untouched. Fixing A1 fixes this too, because `0 - 5 = -5` is a
real movement.

"I looked at this shelf and it is empty" is one of the most valuable statements a count can make, so
prove it works rather than assuming it.

### Test

On-hand 5 from a legacy opening balance, counted 0, opening count → a single movement of −5 and
`on_hand` ends at 0. Repeat for an ordinary count, expecting reason `stocktake_correction`.

## A4 — a resolution can go stale between review and posting  [must]

### Where

Same CTE:

```sql
CASE
  WHEN sr.resolution_type = 'override' THEN sr.resolved_quantity
  WHEN sr.resolution_type = 'sum'      THEN sr.resolved_quantity
  ELSE vs.sum_counted
END AS effective_counted
```

and the pre-flight check earlier in the function, which only verifies that a resolution row
**exists**.

### Why it is wrong

The failing sequence:

1. Two counters scan the same shelf; the owner resolves at 15:00 and the resolution records 15
2. A third counter finishes the back room at 15:10 and adds a scan of 4
3. Posting at 15:20 uses 15 and discards the 4 — silently

The owner is never told, and the variance screen he reviewed is not what posted.

### What to change

Exactly this, no variations:

1. Add two columns to `public.stocktake_resolutions`: `resolved_line_count integer NOT NULL` and
   `resolved_latest_line_at timestamptz NOT NULL`. Put them in a **new** migration file,
   `supabase/migrations/20261104150000_m2b_resolution_staleness.sql` — do not edit an existing
   migration.
2. The endpoint that writes a resolution populates both from that variant's current lines: `COUNT(*)`
   and `MAX(created_at)` over `stocktake_lines` for that `(stocktake_id, variant_id)`.
3. In `post_stocktake`, extend the pre-flight check. A resolution is stale when the variant's current
   line count differs from `resolved_line_count`, or the current `MAX(created_at)` is later than
   `resolved_latest_line_at`. A stale resolution blocks posting with

```
'Cannot post stocktake %: resolution for variant % is stale - lines changed after it was recorded'
```

   and `ERRCODE = 'ST011'`.
4. The variance response marks such a variant as needing re-resolution through the existing
   `resolution_status` field the UI already reads, so the owner sees it on screen instead of only
   hitting the error at post time.

Leave the `sum` branch reading `resolved_quantity`. Do not switch it to recompute from current lines:
a resolution is a decision the owner made about specific lines, and silently recomputing it is the
same class of defect as silently using a stale one.

### Test

The three-step sequence above — resolve, add a late scan, attempt to post — asserting `ST011` and
that no movements were written. Then re-resolve and assert posting succeeds with the quantity that
includes the late scan.

---

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` all green, baseline
  still empty
- Every test listed under A1, A2, A3 and A4 present and passing — nine in total
- `docs/audits/m2b-fix-2-notes.md` written: what changed per defect, anything you believe is wrong in
  these instructions, and the real output of the three commands

Do not run migrations against any remote Supabase project. Do not touch the generated API layer
unless `openapi.yaml` changes; if it does, regenerate through codegen rather than editing generated
files.
