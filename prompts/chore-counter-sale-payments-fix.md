# Chore — counter_sale_payments, fix round

Read `AGENTS.md`, then `docs/audits/chore-counter-sale-payments-audit.md`, then the spec
`docs/tasks/chore-counter-sale-payments.md`. Do not edit the spec or the audit.

Work on branch `chore/counter-sale-payments`. Never commit to `main`. Do not apply any migration; a
human applies them to the test project after this round.

No design note for this round: every change below is already decided in the audit. If you disagree
with one, say so in your notes and still implement it.

## Fix, one commit per item

1. **B1** — in `counter-sale-payments.integration.test.ts` use `other`, not `bank_transfer`. Assert
   `error` is null on every `post` call in the file.
2. **B2** — move `chk_counter_sales_has_payments` and its trigger out of `20261113230200` into
   `20261113230400`, after the function. Make the trigger `AFTER INSERT OR UPDATE OF total_amount` (m2).
3. **M3** — backfill uses `WHERE NOT EXISTS` on the sale, not `ON CONFLICT`.
4. **M1** — add the three missing tests exactly as the audit describes them.
5. **M2** — fix the grant and policy patterns so the four statements in the audit fail the check, and
   add them as fixtures. Add the second check: the last migration defining `post_counter_sale` must
   insert into `counter_sale_payments`.
6. **m1, m3, m4** — rename or restrict the `payment_methods` policy; move the invariant-fixture tests
   beside the other invariant tests and delete the string-matching tests; drop the unused index.

Do not touch `post_counter_sale`'s body beyond what item 2 requires. Do not add `track_stock` here;
that belongs to M4, which rebases onto this branch afterwards (audit B3).

Do not skip or delete any test other than the string-matching ones named in item 6. No `@ts-ignore`,
no `as any`.

## Done means

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. Write
`docs/audits/chore-counter-sale-payments-notes.md`: what changed per item, which tiers you ran, and
whether `database.types.ts` was regenerated. The integration tier runs in CI after the migrations are
applied; do not claim it passed.
