# M3 spec audit — `docs/tasks/warehouse-m3-counter-sale.md`

- **Date:** 2026-11-11
- **Reviewer:** Opus subagent, adversarial spec review
- **Branch / worktree:** `spec/m3-counter-sale` at `f248137`
- **Read:** the M3 spec; `AGENTS.md`; `docs/STATUS.md` (Next, Open 3 and 8, "Two failure modes");
  `.agents/rules/inventory.md`; M1/M2a/M2b/M2c specs and design notes; `identification-scenario-matrix.md`;
  `m2a-fix-notes.md`, `m2c-implementation-notes.md`, `m2c-fix-views-notes.md`; migrations
  `20261102100000`, `20261103210000`, `20261104100000`, `20261104110000`, `20261104130000`,
  `20261104160000`, `20261104170000`, `20261104180000`–`20261105200000`; `supabase/schema.sql`
  (orders, order_items, stock_movements policies); `routes/inventory.ts`, `routes/admin/reservations.ts`,
  `lib/rpc.ts`; `scripts/audit/check-invariants.mjs` (and ran it, plus its definer regex in isolation).
- Nothing was run against any database. Claims about Supabase default privileges are from how every
  Supabase project is provisioned; F1 says how to confirm on the test project.

Spec claims verified as **correct**: §12.1 (the CHECK at `20261104100000:267-268` lacks `reservation`,
so `fulfil_reservation` at `20261104182000:52-66` cannot insert); §12.2's grant to `authenticated`
(`20261104182000:73`) and the Express route using the service client (`reservations.ts:19,261`);
`orders.user_id NOT NULL`, `order_items.quantity integer` (`schema.sql:737,769`); the margin report's
inner join on `stock_movement_costs` (`20261104110000:762`); `counter_sale` in the trigger bypass list
(`20261104190000:29` — only `online_sale` is checked); scan endpoint returns a list and 404 on no match
(`inventory.ts:42-138`); `decrement_order_stock` has the missing-recompute gap (no call in the function
or anywhere in `artifacts/api-server/src`).

---

## F1 — blocker — `REVOKE … FROM public` does not remove `anon`/`authenticated` on Supabase

- **Spec:** §12.2 ("Revoke it and grant `service_role` only"), §13 bullet 2 ("`REVOKE ... FROM public`,
  `GRANT` to `service_role` only"), §17.8.
- **Claim:** revoking from `public` plus a `service_role` grant leaves a definer function callable only
  by the server.
- **Evidence:** Supabase provisions `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO
  anon, authenticated, service_role`. Those are direct grants to the roles, not via `PUBLIC`, so
  `REVOKE … FROM public` leaves them in place. The project already knew this: every M2a/M2b function
  revokes `FROM public, anon, authenticated` (`20261104110000:851-870`, `20261104160000:297`), and
  `m2a-fix-notes.md:48` records that as the rule. M2c dropped it:
  `decrement_order_stock` — `20261104181000_m2c_order_stock_decrement.sql:92-93` (`FROM public` only);
  `fulfil_reservation` — `20261104182000:72-73`. `schema.sql:1292,1367` mirror both.
- **Failing scenario:**
  1. An anonymous visitor (anon key is public in the storefront bundle) runs
     `POST /rest/v1/rpc/decrement_order_stock {"p_order_id":"<any uuid>","p_lines":[{"variant_id":"<v>","quantity":5}]}`.
     The `SECURITY DEFINER` function inserts `online_sale` movements and stock falls, up to available, for any variant.
     This is a live hole, not only an M3 risk, and §12 does not mention it.
  2. An implementer follows §13 literally for `post_counter_sale(p_id, p_actor_id, …)`: `REVOKE FROM public;
     GRANT TO service_role`. Any shopper, or anon, can post sales under any staff id. §12.2's fix for
     `fulfil_reservation` written the same way still leaves `anon` and `authenticated` holding EXECUTE.
- **Fix:** In §12.2 and §13, require `REVOKE EXECUTE … FROM public, anon, authenticated` and
  `GRANT … TO service_role`. Add `decrement_order_stock` to §12 as a third carried-forward defect, in its
  own migration. Add a §17.7 test that an anon key and a shopper token both get `42501` on
  `/rpc/decrement_order_stock`, `/rpc/fulfil_reservation`, `/rpc/post_counter_sale` and
  `/rpc/void_counter_sale`. Before writing the migration, a human can confirm read-only on the test project
  with `has_function_privilege('anon','public.decrement_order_stock(uuid,jsonb,uuid)','EXECUTE')`.

## F2 — blocker — the invariant §12.2 extends checks nothing, and its scope stops at 20261104

- **Spec:** §12.2 (why the invariant missed it), §17.8, §18 ("`audit:invariants:strict` green").
- **Claim:** `security-definer-service-role-privileges` missed `fulfil_reservation` "because it only
  requires *a* `service_role` grant … and it scans only `20261104*`". Adding a GRANT-to-anon rule closes it.
- **Evidence:** `check-invariants.mjs:356`. The function regex ends in `\$\$(.*?)\$\$;` with flags `gi`.
  There is no `s` flag, so `.` cannot cross a newline, and no multi-line function body ever matches. I ran the
  pattern over every `20261104*`/`20261105*` migration: **0 matches out of 13 `SECURITY DEFINER`
  occurrences**. With flag `gis`, `fulfil_reservation` matches at once. The check passes because
  it never inspects a function. Also, the REVOKE regex (`:372`) only requires `FROM … public`, so it
  would accept F1's pattern even if it ran. The path filter `/^supabase\/migrations\/20261104/`
  (`:354`) means M3's `2026111x` migrations are not scanned at all. The same filter limits
  `no-cost-column-on-staff-tables` (`:229`). Its `STAFF_TABLES` (`:209`) will not include the new
  staff-readable tables.
- **Failing scenario:** The implementer adds "fail on GRANT … TO anon|authenticated" inside the existing loop.
  `post_counter_sale` is written with `GRANT … TO authenticated`. Strict mode stays green because the loop body
  never runs. §18's done-gate passes on a shopper-callable sale RPC.
- **Fix:** In §12.2 / §17.8:
  1. Add the `s` flag.
  2. Require a revoke covering `anon` and `authenticated` (or `ALL`), not just `public`.
  3. Fail on any grant to `anon`/`authenticated`.
  4. Scan `>= 20261104` instead of the literal `20261104` prefix, in this check and in
     `no-cost-column-on-staff-tables` and `no-expected-quantity-on-staff-endpoints`.
  5. Add `counter_sales`, `counter_sale_lines`, `bundles` and `bundle_lines` to `STAFF_TABLES`.
  6. Add a unit test that feeds the check a known-bad multi-line fixture and asserts it fires.

  Without item 6, a check that matches nothing will look the same as one that passes. Correct the
  diagnosis in §12.2 so the design note does not repeat it.

## F3 — major — a void as `counter_sale` with a positive delta does not net to zero in the cost or margin code

- **Spec:** §6 "Void" ("The margin report nets the pair to zero units and zero revenue"), §14 void row, §15.4–5.
- **Claim:** compensating movements with reason `counter_sale` and a positive delta net out.
- **Evidence:** `recompute_variant_cost` CASE D (`20261104170000:177-185`) treats every `counter_sale` as
  outbound. It writes `total_cost = ROUND(ABS(quantity_delta) * avg, 2)`, which is **positive** for the
  void as well as the sale. The margin report sums `cogs_total` for `reason IN ('online_sale','counter_sale')`
  without regard to sign (`20261104110000:806`). Its revenue CASE (`:785-786`) uses `ABS(quantity_delta)`.
  The M2a design note (`m2a-receiving-cost.md:174-175`) states the same formula as the contract.
- **Failing scenario:** Sale of 1 unit at 10.00 with avg cost 6.00, then the owner voids it. After the
  natural extension of the revenue CTE (lines priced by `ABS(delta)`), the period shows revenue 20.00,
  COGS 12.00 and units 0. That is a doubled margin on a sale that never happened. If the void is posted
  at `now()` instead of the original `posting_date`, the returned unit also re-enters the basis at that
  day's average rather than the cost it left at.
- **Fix:** State in §6 that every counter-sale term in the margin report is signed by `quantity_delta`:
  revenue = `-delta × net unit price`, COGS = `-SIGN(delta) × total_cost`. Add a §17.7 test that
  exercises exactly this pair. Decide the void's `posting_date` = the original sale's `posting_date`, so
  CASE D's average equals the sale's unit cost (no CASE D change needed). Say so instead of leaving it
  to §15.5.

## F4 — major — *needs owner* breaks §4 and strands the only record of a paid sale on one device

- **Spec:** §4, §9 bullets 4–5, §14 rows "on-hand guard" and "sign-out blocked".
- **Claim:** A queued sale rejected with `ST001` stays on the device as *needs owner*. Staff cannot
  discard it. The owner corrects stock and retries, or discards it with a note.
- **Evidence:** §4 says the till "does not get to refuse it after the money has changed hands", yet
  `trg_apply_stock_movement` raises `ST001` (`20261104190000:61-72`) for a sale that already happened.
  The queue exists only in one browser's IndexedDB under one signed-in staff user, and sign-out is disabled.
- **Failing scenario:** The till goes offline at 11:00. The cashier sells the last physical unit of
  variant V, but the system says `on_hand = 0` (an uncounted receipt). The sale syncs at 11:20 and
  gets `ST001`, so it becomes *needs owner*. The owner is not in the shop.
  - The cashier cannot sign out (queue non-empty), so the next shift works under her name.
  - The owner cannot open the item from his phone, because it does not exist on the server.
  - To resolve it he must use the cashier's device while she is signed in. Any "owner-only" discard
    there is a client-side check on a staff session, so it is unenforceable.
  - A "discard with a note" leaves the note nowhere durable. The paid sale disappears with no
    server record (AGENTS.md "Audit interface").
  - Clearing site data loses it outright.
- **Fix (simpler and safer):** `post_counter_sale` never rejects a queued sale for `ST001`. It stores
  the header and lines server-side with `status = 'needs_owner'` and no movements, then returns
  success, so the device queue empties. The owner sees the sale on any device. He corrects stock, then
  calls an owner-only `post_pending_counter_sale` (or voids it with a reason, which is stored). This
  keeps the on-hand guard intact, removes device stranding, and leaves sign-out blocked only for unsynced
  sales. Online sales also need a pre-check: the scan response already carries `on_hand`
  (`inventory.ts:118`), so the client can warn at scan time when quantity > on_hand. Payment usually
  happens *before* the cashier presses *Complete*, so `ST001` at *Complete* is already after the money
  moved. The spec's "cashier sees ST001 before payment" (§14) assumes a button order that the spec
  never fixes. Either specify the order or route online `ST001` through the same `needs_owner` path.

## F5 — major — the stocktake late-sync flag misses every sync that lands after the count is posted

- **Spec:** §14 row "Offline sale synced after a count line was entered", §15.8.
- **Claim:** The variance review flags lines whose variant has a `counter_sale` movement with
  `posting_date ≤ snapshot` and `created_at >` the snapshot.
- **Evidence:** That flag can only be evaluated while the stocktake is a draft. `post_stocktake` writes
  `counted − snapshot` deltas once and freezes them (`20261104160000:221-266`). Snapshots carry
  `captured_at` (`20261104130000:151-155`).
- **Failing scenario:**
  - Sold offline at 14:00. Line counted at 14:30 (correction −1). Owner posts the stocktake at 14:45.
    The sale syncs at 15:00 (−1 again). No draft exists any more, so there is no flag, and on_hand is
    1 below the shelf with nothing pointing at it.
  - The same happens with an owner **void** posted at the original `posting_date` (F3) after a count:
    the count already put the wrongly-scanned unit back (+1), and the void adds another +1. Voids are
    `counter_sale` movements, so they fall under this rule's predicate, but they have the same blind spot.
- **Fix:** Put the check on the side that arrives late. Inside `post_counter_sale` / `void_counter_sale`,
  for each variant, if a `stocktake_line_snapshots.captured_at` lies in `(posting_date, now()]` for any
  draft or posted stocktake, set a line flag (for example `posted_after_count`) and show it in the
  owner's flagged list (§17.5). Keep the draft-variance flag as well. M2b's arithmetic is not changed.

## F6 — major — device-clock `posting_date` backdates every *online* sale and has no lower bound

- **Spec:** §6 `posting_date = LEAST(sold_at, now())`, §6 header (`sold_at` = device clock), §14 row 5.
- **Claim:** "Online: ≈ now."
- **Evidence:** The spec applies the same formula to sales posted live, and gives no floor.
- **Failing scenario:**
  - The shop tablet's clock is 4 minutes slow, which is ordinary. Every online sale is backdated by
    4 minutes. A count line snapshotted at 14:02 and an online sale at 14:03 (device 13:59) trips F5's
    and §14's late-sync flag on a sale that was never offline, so there are false flags all day.
  - A device whose clock reset to 2025 posts a queued sale into last year's margin period and replays
    cost from there. `LEAST` caps only the future.
- **Fix:** Use `posting_date = now()` for sales posted directly. Use `sold_at` only for sales the
  client submits as queued, bounded to `[now() − N days, now()]` (N small, for example 3; the queue only
  survives a drop while the screen is open). Outside that range, clamp to `now()` and set a flag.
  Store `sold_at` as given, for the receipt.

## F7 — major — the bundle discount is client-supplied and survives removing the bundle's lines

- **Spec:** §5 last bullet, §6 "Discount", §10 paragraph 2, §13 ("Free discount: staff no").
- **Claim:** Staff can discount only through an owner-defined bundle.
- **Evidence:** The header `discount_amount`/`discount_source` arrive in the posting payload. §10 says
  "the discount does **not** recompute" after the cashier adds or removes lines. §15.2 lists where the
  override and mismatch flags are computed but gives no server-side validation of the discount.
- **Failing scenarios:**
  1. Ordinary flow: a box of 3 (list 30, bundle price 20) adds a discount of 10. The customer keeps only
     one item (list 10), and the cashier removes two lines, so the sale total is 0.00.
  2. Crafted request: a staff token posts `discount_source='bundle', discount_amount=50` with no bundle lines.
     Nothing in the spec rejects it, so staff can give a free discount without the owner. That
     contradicts M1 and §16.3's default.
  3. Pro-rating (§6) spreads a bundle discount across *all* lines, so an unrelated item bought alongside
     the box shows a depressed margin.
  4. Bundles are not in the offline snapshot (§9 lists variant fields only), so the bundle button fails offline.
- **Fix:**
  - The server derives the bundle discount from `bundle_id`-tagged lines and the stored `bundle_price`.
    The discount is capped at the list total of that bundle's lines still present. Any client-supplied
    figure is ignored, or rejected if it differs.
  - `discount_source='owner'` is accepted only when the session role is `admin`.
  - Pro-rate a bundle's discount over that bundle's lines only.
  - Either add bundles to the snapshot or state that bundles are online-only.

## F8 — major — deposit pick-ups cannot appear in the margin report as specified

- **Spec:** §8 last sentence, §12, §14 last row, §15.4, §15.7.
- **Claim:** The margin report "must price [pick-ups] from `reservations.agreed_price`". Only
  `decrement_order_stock` is named as possibly missing the cost recompute.
- **Evidence:** `fulfil_reservation` (`20261104182000:52-66`) inserts its movement and never calls
  `recompute_variant_cost`. No Express caller does either (`rpc.ts:139-150`, `reservations.ts:261`). The
  margin report inner-joins `stock_movement_costs` (`20261104110000:762`), so pick-ups are invisible
  until some later replay for that variant happens to cover them. Also, `agreed_price` is the reservation
  **total**: `paid_amount ≤ agreed_price` and fulfilment compares total paid to it
  (`20261104180000:14-15`, `20261104182000:33-35`). It is not a unit price.
- **Failing scenario:** A 2-unit deposit with `agreed_price` 80 is picked up today. Today's margin shows
  nothing. If the implementer copies the order pattern (`unit_price × ABS(delta)`), revenue shows 160
  once a replay creates the cost row. Also, the final payment taken at the till has no
  `payment_method`, although §6 says payment method "cannot be backfilled".
- **Fix:** Add to §12 a migration that makes `fulfil_reservation` (and `decrement_order_stock`, the same
  three-line loop over distinct variants, so §6's "one-line" scope test should not exclude it) call
  `recompute_variant_cost(variant, posting_date)`. State that pick-up revenue = `agreed_price`
  (pro-rata by quantity only if a reservation can be partly fulfilled, which it cannot today). Decide
  whether the pick-up records a payment method.

## F9 — major — the old unpriced till path and direct ledger inserts stay open beside the new document

- **Spec:** §1 (the problem is `counter_sale` adjustments with no price), §13, §17.8.
- **Claim:** After M3, counter sales are priced documents written only through definer functions.
- **Evidence:**
  - `POST /admin/stock/adjust` still accepts `counter_sale` and `online_sale` from staff. It records
    `reference_type 'manual'` with a client-supplied `posting_date`, `transaction_id` and
    `correlation_id` (`inventory.ts:358-432`), and never calls `recompute_variant_cost`.
  - `stock_movements` keeps the M1 policy "Movements: staff/admin insert" (`20261102100000:186`,
    `schema.sql:470`). No client code inserts movements (`artifacts/store/src` has no
    `stock_movements` reference), so the policy has no user. Once §12.1 adds `counter_sale` to the
    `reference_type` CHECK, a staff token can insert a `counter_sale`/`reference_type='counter_sale'`
    movement through PostgREST that points at an existing sale line.
- **Failing scenario:**
  - Staff keep using the adjust screen they already know, because it is faster. `unpriced_units_out`
    never falls (§14's last row fails).
  - A staff token can also add forged movements that a reference-type-keyed revenue join will price a
    second time.
- **Fix:**
  - Remove `counter_sale` and `online_sale` from the adjust endpoint's `VALID_REASONS`.
  - Drop the staff insert policy on `stock_movements` in its own migration.
  - Price counter movements in the margin report by joining through the server-set `transaction_id` to
    `counter_sales` (status-aware), not by trusting `reference_type`/`reference_id` alone.
  - Add an invariant: no INSERT policy on `stock_movements` for a client role.

## F10 — minor — the sign-out lock misattributes sales at the shift change it is meant to protect

- **Spec:** §9 "Actor", §14 sign-out row.
- **Scenario:** One till, 3 staff. The connection is down at the 14:00 shift change and the queue is
  non-empty. Sign-out is blocked, so cashier B sells under A's session until reconnect. That is the
  misattribution the rule exists to prevent. F4's server-side `needs_owner` shortens the lock but does
  not remove it.
- **Fix:** Store both `cashier_id` (taken from the queued record, validated server-side to be a current
  staff or admin user) and `posted_by` (the session user). Then sign-out can be allowed once the queue
  is moved to a per-user store, or the limit can be stated plainly in the design note as accepted.

## F11 — minor — the concurrency test in §17.7 contradicts itself

- **Spec:** §17.7 "two cashiers selling the last unit concurrently (both post, override flagged,
  on-hand guard holds)".
- **Evidence:** With `on_hand = 1` and `allow_negative_stock` off (the §16.9 default), the second post
  gets `ST001` (`20261104190000:61-72`). "Both post" and "on-hand guard holds" cannot both be true.
- **Fix:** Specify two tests. (a) `on_hand = 2` with 1 reserved: both post and the second line is
  flagged `reservation_override`. (b) `on_hand = 1`: one posts, and the other goes down the
  `ST001`/`needs_owner` path.

## F12 — minor — `track_stock = false` variants cannot be sold at the till

- **Spec:** §19 "Changing `track_stock` semantics … counter lines post movements as online sales do today".
- **Evidence:** Neither the trigger (`20261104190000`) nor any RPC reads `track_stock`. A non-stocked
  variant has `on_hand = 0`, so every till line gets `ST001`, which contradicts §4 for an item the shop
  can always supply.
- **Fix:** Either post no movement for `track_stock = false` lines (record price only), or state the
  limitation and that such items need `allow_negative_stock`.

## F13 — minor — the margin report's uuid cast constrains every new `reference_id`

- **Spec:** §15.1 (`reference_type` values), §15.4.
- **Evidence:** `get_margin_report` joins `ON ms.reference_type = 'order' AND ovup.order_id =
  ms.reference_id::uuid` (`20261104110000:792-794`). Postgres does not promise short-circuit evaluation
  in join quals. A `counter_sale` movement whose `reference_id` is a human `sale_number` ("CS-000123")
  can make the whole report fail with `invalid input syntax for type uuid`.
- **Fix:** Specify `reference_id = counter_sale_lines.id::text` (a uuid), or guard the cast when
  extending the CTE.

## F14 — minor — the offline queue drives most of the risk and its need is unmeasured

- **Spec:** §9, §16.5.
- **Observation:** F4, F5, F6 and F10 all come from the offline queue. How often the connection drops is
  unknown (§16.5), yet the default builds the full queue, snapshot, needs-owner list and sign-out lock.
  The online counter sale alone solves §1's problem (priced sales, on_hand kept true).
- **Fix:** Split the work: M3a (online sale, search and picker, reservation warning, bundles, void, receipt,
  margin) and M3b (offline queue) once §16.5 is answered. If both stay in M3, order §17 so that M3a is
  usable and merged before the queue begins.

Rejected in part, because a separate M3b spec would duplicate §4–§8, which the queue depends on. The
spec takes the second option instead: M3a and M3b on one branch, M3a merged first (§2, §17), and the
architect may drop M3b if §16.5 says drops are rare.

## F15 — minor — a third M2c defect at the pick-up point: staff can mark a reservation fulfilled with no movement

- **Spec:** §5 bullet 4 ("Nothing in M3 writes to `reservations` except via the existing `fulfil_reservation`"), §12.
- **Evidence:** Policy "Reservations: staff update" (`20261104180000:59-65`) lets a staff token update
  any row to `status = 'fulfilled'`, setting `fulfilled_by`/`fulfilled_at` itself, directly through
  PostgREST. No `counter_sale` movement is written, so the unit never leaves stock.
- **Failing scenario:** The goods leave with the customer, on_hand stays +1, and availability rises by
  the released reservation. Express does not use this path (it uses the service client), so the policy
  has no legitimate user.
- **Fix:** Carry it into §12. Restrict the staff update policy's `WITH CHECK` to `status = 'active'`, or
  drop staff UPDATE entirely, since every write already goes through Express with the service client.

---

## Verdict

**needs rework**

Two blockers (F1, F2) are in the security instructions that the implementer is told to follow
literally. Followed as written, the spec produces a shopper- or anon-callable `post_counter_sale` and
leaves the live anon-callable `decrement_order_stock` untouched. Its done-gate (`audit:invariants:strict`)
relies on a check that inspects no function at all. The majors are the "precise but incomplete" failure mode STATUS.md warns about:
- The void "nets to zero" only on paper (F3).
- *Needs owner* contradicts the phase's own §4 invariant and strands paid sales on one device (F4).
- The stocktake flag misses the post-posting case (F5), and the clock rule backdates every online sale (F6).
- The bundle rule leaves a free-discount path open to staff (F7).
- Pick-ups cannot reach the margin report (F8).
- The old unpriced till path stays open (F9).

None of this needs a new architecture. Each fix is a sentence or a small rule in the spec, and F14
lowers the risk by splitting the offline queue out. The spec's core decisions hold up against the
code: a counter sale as its own document, one `transaction_id`, the trigger bypass, reservations
untouched, no BOM. Because the corrections land in §4, §6, §9, §12 and §13, a revised draft should be
re-read end to end rather than patched.

---

## Resolution (architect, 2026-11-11)

Spot-checked F1, F2, F3 and F9 against the code before accepting; all four hold. The spec was
rewritten end to end, as the verdict asked.

| Finding | Outcome | Where in the spec |
|---|---|---|
| F1 | Fixed. Revoke from `public, anon, authenticated`; `decrement_order_stock` added as a defect | §12.2, §13, §17.7 |
| F2 | Fixed. Diagnosis corrected; `s` flag, revoke/grant rules, scan range, `STAFF_TABLES`, fixture test | §12.3, §18 |
| F3 | Fixed. Void at original `posting_date`; margin terms signed by `quantity_delta` | §6, §14 |
| F4 | Fixed. `needs_owner` stored server-side, no movements; owner resolves from any device | §4, §6, §9 |
| F5 | Fixed. `posted_after_count` set by the late-arriving movement, draft or posted stocktake | §14, §17.10 |
| F6 | Fixed. Live sales use `now()`; queued `sold_at` clamped to 3 days | §6 |
| F7 | Fixed. Discount computed by server; complete-bundle rule; per-bundle pro-rating; bundles in snapshot | §6, §9, §10 |
| F8 | Fixed. Recompute added to `fulfil_reservation` and `decrement_order_stock`; `agreed_price` is a total; no pick-up payment method in M3 (customer question) | §8, §12.4, §16.4 |
| F9 | Fixed. Adjust endpoint stops accepting sale reasons; staff insert policy dropped; revenue joined via `transaction_id` | §6, §12.5 |
| F10 | Fixed. Queued `cashier_id` validated, `posted_by` = session; sign-out lock removed | §6, §9 |
| F11 | Fixed. Two separate concurrency tests | §17.7 |
| F12 | Fixed by stating the limitation and asking the customer | §16.11, §19 |
| F13 | Fixed. `reference_id = counter_sales.id::text`; guarded cast | §6, §15.4 |
| F14 | Partly fixed: M3a/M3b ordering; separate spec rejected (see under F14) | §2, §17 |
| F15 | Fixed. Staff UPDATE on `reservations` dropped | §12.6 |

14 fixed, 1 rejected in part (F14), 0 rejected outright.
