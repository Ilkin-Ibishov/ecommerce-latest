# M3a design note audit: `docs/design-notes/m3-counter-sale.md`

- **Date:** 2026-11-11
- **Reviewer:** adversarial review subagent
- **Branch:** `m3a/counter-sale` at `aa145c5`
- **Read:** the design note; spec `docs/tasks/warehouse-m3-counter-sale.md`; `docs/audits/m3-spec-audit.md`;
  `AGENTS.md`; `.agents/rules/inventory.md`, `migrations.md`; migrations `20261102100000`, `20261103210000`,
  `20261104100000`, `20261104110000`, `20261104130000`, `20261104160000`, `20261104170000`, `20261104180000`,
  `20261104183000`, `20261104190000`, `20261111110000`–`20261111110200`; `routes/inventory.ts`,
  `routes/admin/reservations.ts`, `lib/rpc.ts`, `scripts/audit/check-invariants.mjs`.
- Nothing was run against a database. Every claim below comes from reading the SQL and code.

**Claims in the note that check out:**
- decrement_order_stock locks variant rows `ORDER BY pv.id ASC FOR UPDATE` (`20261111110100:42-61`).
- Reservation creation takes no lock (`reservations.ts:155-192`), so note finding 8 holds against M2c Rule 2.
- `ST001` is raised only by the trigger inside the proposed block (the other `ST001` raises are in
  `set_variant_stock_safe`).
- An `INSERT … ON CONFLICT DO NOTHING` waits for a concurrent inserter of the same key.
- jsonb text output is key-order normalised.
- CASE D values a `counter_sale` void at the average current at that point in the replay. A void at the
  original `posting_date` sorts straight after the sale (same `posting_date`, later `created_at`), so
  its cost equals the sale's cost (`20261104170000:101,177-185`).
- The online-order revenue and COGS terms are unchanged by Q4.

**Claims that are false:** see A1, A9 and A12.

---

## A1. Major. `allow_negative_stock` does not "keep working": with it on, an oversell loses the whole sale

- **Note:** Q2 step 8 ("the trigger stays the only place that decides … `allow_negative_stock` keeps
  working unchanged"); §4 row "`needs_owner` via the trigger's `ST001`"; §6 item 7.
- **Evidence:**
  - `product_variants.on_hand` still carries `CHECK (on_hand >= 0)` (`20261102100000:17`, `schema.sql:249`).
    No migration drops it.
  - With the setting on, the trigger runs an unguarded
    `UPDATE … SET on_hand = on_hand + delta` (`20261104190000:46-59`). Postgres raises **23514
    check_violation** before `negative_stock_override` is ever set.
  - The only test, `allow-negative-stock.test.ts:21-46`, runs against a JS mock, not the database.
- **Failure scenario:** The owner answers §16.9 "yes, sell at zero" and turns the setting on. A cashier
  sells the one unit the system thinks is 0. The trigger raises 23514, and
  `EXCEPTION WHEN SQLSTATE 'ST001'` does not catch it, so the whole transaction rolls back. The header
  and lines are not stored and the device gets a 500 after the money has changed hands. That breaks
  spec §4, the invariant that defines the phase. Online orders and pick-ups fail the same way.
- **Fix:** Say in the note that `allow_negative_stock = true` is broken today. Then either:
  - add a separate migration that drops `product_variants_on_hand_check` (the trigger already enforces
    non-negative when the setting is off), with an integration test on the live ledger; or
  - state that the setting is unsupported in M3a and have the Express setting route refuse `true`.

  Do not widen the handler to catch `23514`. That would hide the bug as `needs_owner`.

## A2. Major. The cashier must know the total before payment, but the discount exists only inside SQL

- **Note:** Q2 step 5, Q3 ("All amounts are worked in qəpik"), §5 "Unit: discount allocation (property test)".
- **Evidence:** Discounts and allocation are computed inside `post_counter_sale` (plpgsql), and the
  response is the only place `total_amount` appears. The counter screen has to show a total before the
  customer pays (spec §4: payment usually comes before *Complete*, see spec audit F4). `pnpm test:unit`
  is offline (AGENTS.md), so a "unit" property test cannot exercise an allocation that lives in plpgsql.
- **Failure scenario:** The device reimplements the k-sets and largest-remainder rules to show a total.
  The owner changes `bundle_price` after the counter page loaded, or the two implementations round
  differently. The customer pays 18.00 and the server records `total_amount` 20.00. No flag is raised,
  because the device never sends the total it displayed, and the receipt (rendered from the server)
  disagrees with the cash taken.
- **Fix:** Put the discount and allocation in one pure TypeScript module in `lib/`, used by the counter
  screen for display and by Express to build the posting. Express passes the per-line `net_line_total`
  and the header amounts to `post_counter_sale`, which checks `Σnet = total` and `net ≥ 0`. Express is
  the trusted side; the device is not. The property test then really is a unit test. Also have the
  device send `displayed_total`, and set a header flag (not a rejection, per §4) when it differs from the
  server total.

## A3. Major. The allocation rule is wrong when a bundle discount and an owner discount meet; edge cases are open

- **Note:** Q3.
- **Evidence and scenarios:**
  1. **Base for the second stage.** Step 3 says `net_line_total_i = gross_i − share_i`, which is a
     one-discount formula. Take a bundle line with gross 10.00 that gets 9.00 of bundle discount (net
     1.00), and a loose line with gross 10.00 (net 10.00). The owner's discount is capped at the total,
     11.00. Allocated over gross, each line takes 5.50, so the bundle line ends at **−4.50**.
     `net_line_total` has no `CHECK (>= 0)`, so this reaches the margin report as negative revenue. The
     owner discount must be allocated over net-after-bundle.
  2. **Σgross = 0.** If every line has charged price 0 (a free item, or a crafted request), then
     `D × gross_i / Σgross` is 0/0 and the division raises an error, which rolls back the whole sale.
  3. **A tagged line whose variant is not in the bundle.** It does not enter *k*, but it is "tagged", so
     it takes a share of the discount. Specify that such lines are untagged, or rejected with `400`.
  4. **Tagged units beyond k sets.** Bundle {A×1, B×1} with tagged A×3 and B×1 gives k = 1, but the
     discount spreads over all three A units. Allocate over k × defined quantity only, or accept the skew
     and say so.
  5. **Bundle state.** `bundle_price NULL` happens to give 0 in SQL, because `GREATEST` ignores NULL. In
     TypeScript it needs an explicit branch. State whether `is_active = false` bundles still discount.
  6. **Fractional quantity.** `gross_i` is not an integer number of qəpik when quantity is fractional.
     State the rounding to whole qəpik, or that the M3a UI keeps quantities integer.
- **Fix:** Give the two stages explicitly. Stage 1 (bundle) uses base `gross_i` over that bundle's
  tagged lines. Stage 2 (owner) uses base `net1_i` over all lines. Return early when D = 0 or the base
  sum is 0. Add `CHECK (net_line_total >= 0)`. Add cases 2–5 to the property test.

## A4. Minor. Margin revenue built from a divided unit price is not an exact amount

- **Note:** Q4 (`Σ net_line_total / Σ quantity`; `r.agreed_price / r.quantity`).
- **Scenario:** A line of 3 units with net 10.00. `10.00/3 × 3` gives `9.9999999999999999` in Postgres
  numeric. A 3-unit pick-up with `agreed_price` 80.00 shows 79.99999…. A sale and its void still net to
  zero, but the daily revenue no longer matches the receipts. Online orders carry the same flaw today
  (`20261104110000:785`), so this is not a regression.
- **Fix:** Round per movement: `ROUND(−delta × Σnet / Σqty, 2)`. The sale and the void round
  identically, so they still net to zero. For a pick-up, use `agreed_price × (−delta / r.quantity)`; a
  reservation has exactly one movement, so this is simply `agreed_price`.

## A5. Minor. The void's `transaction_id` and `correlation_id` contradict the M2a reversal it cites, and the line-to-movement mapping is open

- **Note:** Q2 `void_counter_sale`; §4 row "Void at the original `posting_date`".
- **Evidence:** `reverse_goods_receipt` gives the reversal its **own** `transaction_id` and sets
  `correlation_id` = the original **transaction** id (`20261104110000:638,693-706`). The note reuses the
  sale's `transaction_id` and sets `correlation_id` = the original **movement** id. M1's comment says
  `transaction_id` groups "a single operation" (`20261103210000:37`). The note also says "one movement
  per line", but movements carry no `line_no`. With one variant on two lines (once in a bundle, once
  loose), which movement does each void line correlate to?
- **Fix:** Keep `transaction_id = sale id` for the void if the margin join needs it, but list this as a
  deviation from M2a in §6, with the reason. Void per original movement:
  `INSERT … SELECT … FROM stock_movements WHERE transaction_id = id AND quantity_delta < 0`, with
  `correlation_id = sm.id`. That is unambiguous and matches M1's column comment.

## A6. Minor. `posted_after_count` misses `post_pending_counter_sale` and counts cancelled stocktakes

- **Note:** Q2 step 6 ("can only be true for queued sales and for voids"); Q7.
- **Evidence:** `post_pending_counter_sale` posts at the sale's stored `posting_date`, often days later.
  That is a backdated movement exactly like a void. The Q7 predicate has no join to `stocktakes`, so
  snapshots from `status = 'cancelled'` stocktakes (`20261104130000:19`) also set the flag.
- **Scenario:** A sale is stored `needs_owner` on Monday. Tuesday's count snapshots the variant without
  the sale. On Wednesday the owner adjusts and posts it at Monday's date. The flag is not set, and the
  owner has nothing to explain Tuesday's correction.
- **Fix:** Compute the flag in all three paths (live/queued post, post-pending, void) and add
  `JOIN stocktakes st … WHERE st.status <> 'cancelled'`. If a void and a late post need telling apart,
  record which one set the flag.

## A7. Minor. Lock ordering prevents deadlock only against `decrement_order_stock`; void and post-pending have no lock pass

- **Note:** Q2 step 3; §4 row "One lock pass".
- **Evidence:** `post_goods_receipt` inserts in `sort_order` order (`20261104110000:583-606`), and
  `post_stocktake` in unspecified order (`20261104160000:245-273`). Both lock variant rows through the
  trigger's `UPDATE`, not in ascending id. The note gives `void_counter_sale` and
  `post_pending_counter_sale` no ordered lock pass at all.
- **Scenario:** On count day the owner posts a stocktake covering {V2, V1} while a cashier sells V1 and
  V2. Postgres detects the cycle and aborts one transaction with `40P01`. If the aborted one is the
  sale, the cashier gets a 500.
- **Fix:** Give void and post-pending the same `FOR UPDATE ORDER BY id` pass. In Express, retry
  `post_counter_sale` once on `40P01`/`40001` with the same `id`; idempotency makes the retry safe.
  This needs no change to M2a or M2b at this volume.

## A8. Minor. `chk_void_attribution` accepts a void with no reason

- **Note:** Q1 schema, lines 71-72.
- **Evidence:** When `void_reason` is NULL, `char_length(trim(NULL)) > 0` is NULL. The whole CHECK then
  evaluates to NULL, and a CHECK that evaluates to NULL passes. The reason is required by spec §6 ("voids
  it with a stored reason").
- **Fix:** `… AND void_reason IS NOT NULL AND char_length(trim(void_reason)) > 0`. Apply the same
  pattern wherever a nullable column sits inside a CHECK.

## A9. Minor (false claim). `requireStaffOrAdmin` is defined seven times, not twice

- **Note:** §3 ("defined twice today (`inventory.ts`, `admin/reservations.ts`)… a small refactor").
- **Evidence:** It is defined in `inventory.ts:9`, `admin/reservations.ts:13`, `admin/receipts.ts:8`,
  `admin/receipt-lines.ts:6`, `admin/stocktakes.ts:9`, `admin/stocktake-lines.ts:6` and
  `admin/suppliers.ts:8`.
- **Fix:** Moving it into `middlewares/` and switching all seven files is a 7-file refactor of auth code,
  outside M3a's purpose. Either do it as its own commit and say so in the note, or have only the new
  counter routes import the shared copy and leave a note to migrate the rest.

## A10. Minor. Gaps an implementer must guess in `post_counter_sale`

- **Note:** Q2 steps 1–8.
  1. **Insert-first header.** The step 1 `INSERT` needs `total_amount`, `status` and `posting_date`,
     all `NOT NULL`, which are computed only in steps 5–7. Say whether the insert uses placeholders and
     is updated afterwards, or whether steps 2–7 run first and the insert comes later. The second keeps
     the header written once, apart from the `needs_owner` status change.
  2. **Cart edited after an unknown outcome.** A Complete times out, the cashier adds a forgotten item,
     and Complete is pressed again. If the device reuses the id, the server raises `ST020` at the till.
     If it makes a new id, the first sale may already exist, and the sale is recorded twice. Specify
     that the cart is frozen until the outcome is known, and that further items go on a new sale.
  3. **What the hash covers.** `md5(p_payload::text)` keeps numeric scale (`1.5` ≠ `1.50`). Say that
     the hash is computed over the Zod-parsed object Express passes, not the raw body, so that a resend
     hashes the same.
  4. **Text search.** Escape `%`, `_` and `,` in `q` before building a PostgREST `.or(…ilike…)` filter.
     A comma in the query otherwise breaks or alters the filter.
  5. **Migration testing.** `migrations.md` requires saying whether each migration was tested on an
     empty database and on one with rows. Note that Q4 re-prices existing pick-up movements, which
     until now counted as `unpriced_units_out`. The functions migration will be over 200 lines, which
     AGENTS.md says must be justified in the note.

## A11. Minor. Over-engineering: the queued path in M3a

- **Note:** Q2 signature (`p_queued`), steps 2 and 7, and `needs_owner_reason` as a clock note on a
  `posted` sale.
- **Evidence:** Spec §2 says M3b may be dropped. The M3a function still carries the queued cashier rule
  and the clamp, which nothing in M3a calls and no M3a test covers. Using `needs_owner_reason` as a
  free-text note on a `posted` sale also overloads a status field: a queued sale that gets both the
  clock note and an `ST001` has two reasons for one column.
- **Fix:** Ship `post_counter_sale` without `p_queued`. The M3b addendum adds the parameter with
  `CREATE OR REPLACE` and a `clock_clamped boolean` column, if M3b happens at all.

## A12. Minor (false claim). The rollback plan breaks the invariant gate

- **Note:** §7 ("a new migration disables the counter routes' functions (`REVOKE` from `service_role`)").
- **Evidence:** `security-definer-service-role-privileges` fails any definer that ends without
  `service_role` (`check-invariants.mjs:399-403`). The rollback would turn `audit:invariants:strict` red,
  and spec §18 requires it green at every commit.
- **Fix:** Roll back by unmounting the Express counter routes, which is one line and needs no migration.
  The functions stay service-role-only and unreachable.

---

## Verdict

**ready after fixes**

The core holds against the code:
- One definer function, one `transaction_id`.
- `needs_owner` through a savepoint.
- Void at the original `posting_date`, which CASE D values exactly.
- Signed counter terms that leave online figures alone.
- Staff reads only through Express. Rows cannot hide columns, so this is a correct tightening of §13.

Before implementation, the note must:
- **A1:** stop relying on an `allow_negative_stock` path that cannot work against the live CHECK.
- **A2:** say how the total the cashier collects is guaranteed to equal the total recorded.
- **A3:** fix the two-stage allocation.

The minors are a sentence each.

---

## Response (author, 2026-11-11)

All twelve findings are accepted. The only partial acceptance is A3.4: units tagged beyond *k* complete
sets still share that bundle's discount, which skews revenue between the bundle's own variants but keeps
the sale total exact. The table in `docs/design-notes/m3-counter-sale.md` §8 shows where each finding is
addressed. A1 and A9 were checked against the code before acting: `product_variants.on_hand` carries
`CHECK (on_hand >= 0)` (`20261102100000:17`), and `requireStaffOrAdmin` is defined in seven route files.
