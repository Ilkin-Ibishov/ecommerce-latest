# M2a — fixes after the adversarial audit

`docs/audits/m2a-receiving-cost-audit.md` is the audit. I verified every finding against the code
myself; my verdict differs from the auditor's on F4, and F7 disappears once F1 is fixed properly.
What follows is the list. One commit per item, in this order.

The engine itself held up: replay ordering, atomic posting, double-post prevention via `FOR UPDATE`,
unvalued opening balances excluded from the average, the cost boundary, and the margin report's
fan-out protection were all checked and are sound. Do not refactor any of them while fixing these.

---

## F1 — every new RPC raises `Forbidden` when the API calls it  [blocker]

I confirmed this end to end. `public.is_admin()` resolves `auth.uid()`:

```sql
select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
```

Every route reaches the database through `getAdminSupabase()` — the **service-role** client, which
carries no end-user JWT. `auth.uid()` is therefore NULL, `is_admin()` returns false, and the first
statement of each new function raises `42501`. Verified call sites:

- `routes/admin/receipts.ts` → `.rpc("post_goods_receipt")` and `.rpc("reverse_goods_receipt")`
- `routes/admin/margins.ts` → `.rpc("get_margin_report")`

So posting a receipt, reversing one and opening the margin report all fail for the owner — the three
things this phase exists to do. Nothing in the local test tiers catches it, because the SQL engine is
tested through a TypeScript re-implementation and the route→RPC path only runs in `api-integration`,
which needs CI.

**Do not fix this by making `is_admin()` tolerant of a NULL `auth.uid()`.** That would make every
in-body admin guard in the schema pass for any unauthenticated caller — a far worse bug than the one
being fixed.

Fix it by moving the authorisation to where it belongs, which also resolves F7:

- Remove the in-body `is_admin()` guard from the functions the API invokes with the service role.
  Authorisation for those is the route's `requireAdmin` plus Postgres execute privileges — not code
  inside the function.
- `REVOKE EXECUTE ... FROM public, anon, authenticated` and `GRANT EXECUTE ... TO service_role` for
  each of them. A staff JWT calling through PostgREST then fails at the privilege layer, which is
  stronger than an `IF` statement in the body, and the trusted server path works.
- Keep `p_actor_id` as the recorded actor. The function can no longer discover the caller, so the
  route must pass it and the function must reject a NULL actor where a movement needs attribution.
- `rebuild_on_hand` and `verify_stock_integrity` get the same treatment. They have no routes yet;
  state in your notes that they are reachable only by the service role until a route exists.

**Add an executable invariant so this cannot return.** A `SECURITY DEFINER` function that is called
by the service role must not contain an `auth.uid()`-dependent guard; and any new function in a
migration must carry an explicit `REVOKE`/`GRANT` pair. Encode whichever of those two you can check
reliably in `scripts/audit/check-invariants.mjs`, and say in your notes why you chose that one.

**And add the test that was missing.** An `api-integration` test that posts a receipt through the
Express route and asserts the movements exist. It will not run locally — write it anyway, and say
plainly that you could not execute it. A blocker that reaches an audit because no test covers the
route boundary should leave a test behind.

## F2 — `allow_negative_stock` is inert  [must]

The column exists; nothing reads it. `trg_apply_stock_movement` still enforces
`(on_hand + quantity_delta) >= 0` unconditionally, so turning the setting on changes nothing. A
setting that appears to work and does not is worse than an absent one.

This matters sooner than the audit suggests: during M2b onboarding every variant starts at zero
until the first physical count, so any outflow recorded before that count is rejected.

Wire it. One constraint to resolve rather than work around: the spec requires each override to be
**recorded on the movement**, but `stock_movements` is immutable and `trg_apply_stock_movement` is
`AFTER INSERT`, so it cannot stamp the row it is reacting to. Decide where the override is recorded —
a column set by the caller at insert time, a `BEFORE INSERT` trigger, or a separate small table — and
say why in your notes. Default off stays default off, and the setting is owner-writable only.

I wrote "trivial to add here" in the work order. That was wrong, and the recording requirement is
why. Pick the simplest option that keeps the ledger immutable.

## F3 — an unpriced sale produces a phantom loss  [must]

`/admin/stock/adjust` inserts movements with `reference_type: "manual"` (`routes/inventory.ts`
line 406), including when the reason is `counter_sale`. The margin report derives revenue only where
`reference_type = 'order'`, so such a movement contributes COGS and **zero revenue**.

Concretely: staff records five counter sales through the adjust screen, the owner opens the report,
and the variant shows a loss on goods it sold at a profit. Until the counter UI ships in M3 this is
the normal path for counter sales, so the report would be systematically wrong in the one direction
guaranteed to destroy trust in it.

Do not invent a revenue figure — the system genuinely does not know the price. Make the gap visible
instead:

- A sale movement the report cannot price contributes to **neither** revenue nor COGS in the margin
  figures.
- Report those units separately — an `unpriced_units_out` count per variant and a total — so the
  owner sees "5 units left stock at an unknown price" rather than a fabricated loss.
- Surface it in the UI as a note on the report, not a hidden field.
- Test it: a priced sale and an unpriced outflow in one period must leave margin computed from the
  priced one alone, with the unpriced units counted and labelled.

## F4 — I disagree with the auditor; fix the message, not the behaviour  [must, but smaller]

The auditor reads my audit prompt as requiring reversal to succeed after partial consumption. Read
again what the block actually prevents: receive 10, sell 8, reverse — the reversal asks to send 10
units back to a supplier when 2 exist. **Refusing is correct.** A receipt whose goods are partly gone
cannot be fully reversed, and silently letting on-hand go negative to permit it would be the real
defect.

What is wrong is the diagnosis the owner gets: a generic `Insufficient stock for variant …` from the
apply trigger, with no indication of why or what to do.

- Detect the condition in `reverse_goods_receipt` **before** inserting anything, and raise a specific
  error naming the receipt, the variant, and how many units of it are already consumed.
- Document the remedy in your notes: a full reversal is for a receipt whose goods are untouched;
  otherwise the correction is an adjustment, or a partial reversal, which is out of scope here.
- Do not implement partial reversal in this branch.

## F5 — advisory lock on a 32-bit hash  [minor]

`pg_advisory_xact_lock(hashtext('cost_replay_' || p_variant_id::text))` can collide across variants.
At 500 variants the risk is negligible, but the collision-free form costs the same: derive two
integers from the UUID and use the two-argument `pg_advisory_xact_lock(int, int)`.

## F6 — `rebuild_on_hand` repairs half the problem  [minor]

It repairs `on_hand` and leaves the cost projection as it was, so `verify_stock_integrity` can still
report `projection_vs_ledger` immediately after a successful repair. Have `rebuild_on_hand` recompute
the projection for that variant as its last step, in the same transaction. If you believe the two
repairs should stay separate, say why and make `verify_stock_integrity` name the second repair in its
output instead.

## F7 — resolved by F1

No separate work. Confirm in your notes that execute privileges, not function-body code, are what
block a staff token after F1.

---

## Two items the auditor was told not to look for

**The flaky test gate.** `artifacts/store/src/__tests__/storefront-ux.property.test.ts`, "Property 3
… addItem uses the selected variant's price and label", times out at 5000 ms under full-suite load
and passes alone in about 2000 ms. It predates this branch, but it will fail the CI gate at random,
and a gate that fails at random stops being read. Fix the cause — that test's own timeout, or its
property run count, with the reason stated in a comment. Do not skip it, do not delete it, and do not
change the global `testTimeout`.

**`docs/STATUS.md`.** Update it once the above is green: what M2a delivered, the decisions it closed
and where their reasoning lives, what carries into M2b, and the open items. Keep the existing shape —
it is the entry point for a new session. The two standing open items remain open: `main` is not
pushed, and the Supabase project behind the CI secrets has not been confirmed as separate from
production, so no migration has been applied to any remote database.

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` all green, baseline
  still empty
- The new invariant from F1 present and passing
- The tests named in F1, F2 and F3 present
- `docs/audits/m2a-fix-notes.md` written: what changed per finding, what you disagreed with and why,
  and the real output of the three commands

Say plainly in your notes if you think anything else on this branch is unfinished. After this it goes
to merge.
