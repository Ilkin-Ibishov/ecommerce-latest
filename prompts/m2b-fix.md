# M2b — one defect, and the status doc

The adversarial audit did not complete: the `claude-opus-4-6-thinking` run hit an account quota and
died partway through, committing nothing. Its log is still useful — it had reached the variance
service and examined one thing before stopping. It judged that thing harmless. It is not.

Two commits.

---

## 1. The variance review can silently show a different number than posting will apply  [must]

`artifacts/api-server/src/lib/stocktake-variance.ts`, line 36:

```ts
const { data: snapshots } = await (admin as any)
  .from("stocktake_line_snapshots")
  .select("line_id, snapshot_on_hand, captured_at");
```

Every other query in this function is scoped — `.eq("stocktake_id", stocktakeId)` for lines and
resolutions, `.in("id", variantIds)` for variants and costs. This one fetches **the entire snapshot
table**, every row ever written by every count, and then picks out the ones it needs by `line_id`.

Today that is merely wasteful: 500 rows per full count, unfiltered, on every page load. The defect is
what happens when the result is ever truncated — a PostgREST row cap, a configuration change, a
default page size, a future migration to a paged client. The rows are unordered and unfiltered, so
the ones belonging to the stocktake being reviewed can simply not be in the response.

And then line 101 turns a missing row into the wrong answer rather than an error:

```ts
const snapshotOnHand = snapshotMap.get(latestLine.id) ?? currentOnHand;
```

Falling back to the variant's **current** on-hand is the worst available default for this phase. It
silently reverts the review screen to absolute-set semantics — variance = counted minus on-hand *now*
— which is precisely the arithmetic §4 of the work order exists to prevent. Every sale that happened
during the count disappears from the owner's view of the variance.

The posted correction would still be right, because `post_stocktake` joins the snapshots in SQL. So
the failure is not corrupted stock; it is worse in a different way: **the owner reviews and approves
one set of numbers and posting applies another**, with nothing on screen saying so. For a screen
whose entire purpose is to be the evidence he checks before committing, that is the defect that
matters most in the file.

Fix both halves:

- Scope the query to the lines of this stocktake — by `line_id` against the lines already fetched, or
  by joining through `stocktake_id`. Be consistent with every other query in the function.
- Stop papering over a missing snapshot. A line without one is a broken invariant, not a value to
  guess: the trigger writes exactly one snapshot per line, so its absence means something is wrong.
  Surface it — fail the request, or mark that row unreviewable and count it in the summary — but do
  not substitute a number computed by different arithmetic.

Add a test: a variance review where a line's snapshot row is missing must not report a variance
computed from current on-hand. And a test that the snapshots query returns only this stocktake's
rows, so the scoping cannot regress.

While you are in that file: the header of
`supabase/migrations/20261104140000_m2b_stocktake_functions.sql` advertises a
`get_stocktake_variance` function that the migration never defines — the variance is computed in
TypeScript. Correct the comment. A header that describes functions that do not exist will send the
next reader looking for them.

## 2. `docs/STATUS.md` for M2b  [must]

Update it in the existing shape: what M2b delivered, the decisions it closed and where their
reasoning lives, what carries into M2c (reservations and deposits), and the open items.

Record these accurately, because they are what a new session needs to know and some of them are
uncomfortable:

- **The adversarial audit for M2b did not run.** The Opus 4.6 quota resets in roughly six days. M2b
  has had my architectural review and the mechanical checks, but not an independent adversarial pass
  on a different model family. Say so plainly rather than listing M2b as audited.
- `main` is local-only and unpushed; it now contains M1 and M2a. M2b is on `m2b/stocktake`.
- No migration in this repository has ever been executed against a real Postgres. CI's integration
  tier has been failing since 1 July 2026 and its repair is deliberately postponed. The known work
  there: a dedicated test Supabase project with its three secrets, applying schema and migrations to
  it, `SESSION_SECRET` missing from `test.yml`'s API server step, and a stale assertion in
  `otp-verify-500.exploration.test.ts`.
- Blind counting is not tamper-proof against a staff token reading `product_variants.on_hand`
  directly; the limit is recorded in `.agents/rules/inventory.md`.

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- The two tests above present
- `docs/audits/m2b-fix-notes.md` written, with the real output of the three commands

Do not touch anything else on this branch. Do not run migrations against any remote Supabase project.
