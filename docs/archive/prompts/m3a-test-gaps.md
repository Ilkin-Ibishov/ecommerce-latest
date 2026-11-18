# M3a — close the three untested gaps

M3a (counter sale) is merged. `docs/audits/m3-implementation-notes.md`, section "Not covered by a
test", names three things no test exercises. Write those three tests. Tests and test config only:
do not change any migration, route, page or component. If a test shows the code is wrong, do not
fix the code. Write the failing test, record the failure in your notes and stop.

Work on branch `m3a/test-gaps`, which already exists. One commit per item, plus one for the notes.

Read first: `artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts` and
`artifacts/api-server/tests/helpers/stocked-variant.ts`. Follow their style: service client,
`createStockedVariant`, short `it` names that state the behaviour.

---

## 1. Oversell when `allow_negative_stock` is on

**Behaviour to prove.**
- `site_settings.allow_negative_stock` is one global row. The stock trigger
  `trg_apply_stock_movement` (latest body in
  `supabase/migrations/20261104190000_m2c_trigger_bypass_reasons.sql`) reads it.
- When it is true, an outbound movement may take `on_hand` below zero and sets
  `negative_stock_override = true` on the movement.
- Migration `20261111120000_drop_variants_on_hand_check.sql` dropped the column CHECK that used to
  block this.
- So `post_counter_sale` must return `status: "posted"`, not `needs_owner`, for a sale larger than
  on-hand.

**Why it cannot go in the normal integration project.** The `api-integration` vitest project runs
files in parallel against the shared test database. Many of those files expect `ST001`/`needs_owner`
when stock is short, for example the counter-ledger needs_owner and two-tills tests. Turning the
setting on while they run would break them. This test must run alone, after `api-integration` has
finished.

**Do this:**

- New file `artifacts/api-server/tests/serial/m3a-negative-stock.serial.test.ts`:
  - `beforeAll`: read the `site_settings` row and its `allow_negative_stock`. Assert it is `false`.
    If it is already true, a previous run left it on: fail loudly, do not silently reset it.
  - One test: `createStockedVariant(db, actor, 1)`, then turn the setting on.
    - Post a counter sale of quantity 2 with `post_counter_sale`, shaped as in the counter-ledger
      test.
    - Expect `status: "posted"` and `on_hand === -1`.
    - Expect the sale's single `stock_movements` row to have `negative_stock_override === true`.
  - Turn the setting back off in a `finally` around the test body, not only in `afterAll`, so an
    assertion failure cannot leave it on. In `afterAll`, re-read the row and assert it is `false`.
  - Before writing the update, read `site_settings` to see which column identifies the row, and
    update by that column.
- New config `artifacts/api-server/vitest.config.serial.ts`:
  - name `api-serial`;
  - `include: ["tests/serial/**/*.test.ts"]`;
  - `setupFiles: ["tests/setup.ts"]`;
  - `fileParallelism: false`;
  - `testTimeout` and `hookTimeout` as in `vitest.config.ts`.
  - Do **not** add it to the root `vitest.workspace.ts`: `pnpm test` runs every workspace project at
    once, which is exactly the overlap to avoid.
- `artifacts/api-server/vitest.config.ts`: add
  `exclude: [...configDefaults.exclude, "tests/serial/**"]`, importing `configDefaults` from
  `vitest/config`, so `api-integration` never picks the file up. Change nothing else in that file.
- `.github/workflows/test.yml`, `integration-e2e` job: add one step right after "Run API
  integration tests" and before "Start store dev server":

  ```yaml
      - name: Run serial integration tests (global settings)
        run: pnpm --filter @workspace/api-server exec vitest --run --config vitest.config.serial.ts
        env:
          SESSION_SECRET: ${{ secrets.SESSION_SECRET }}
  ```

  Add a one-line comment above it saying why it runs alone. Touch no other step.

## 2. `posted_after_count` after a stocktake snapshot

**Behaviour to prove.**
- `post_pending_counter_sale` (`20261111120500`) and `void_counter_sale` (`20261111120600`) set
  `counter_sale_lines.posted_after_count = true` when the variant has a snapshot with
  `captured_at > posting_date` in a stocktake that is not cancelled.
- The sale's `posting_date` is `now()` when `post_counter_sale` ran.
- A snapshot row is written automatically by the trigger `trg_capture_stocktake_line_snapshot`
  (`20261104140000`) when a `stocktake_lines` row is inserted. Its `captured_at` is `now()` at that
  insert.

**Do this.** Add a `describe("posted_after_count", …)` block to
`artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts`. It shares that file's `sale`,
`post` and `actor` helpers. Three tests:

1. **Void after a count.**
   - Post a sale of 1 from a variant with on-hand 3.
   - Insert a draft `stocktakes` row with the service client:
     - unique `stocktake_number`, e.g. `ST-M3A-${Date.now()}-${random}`;
     - a `title`;
     - `created_by: actor`.
   - Insert one `stocktake_lines` row for the variant:
     - `counter_id: actor`;
     - `counted_quantity: 2`.
   - Call `void_counter_sale`.
   - Expect the sale's line `posted_after_count === true`.
2. **Post-pending after a count.**
   - From a variant with on-hand 0, post a sale of 1. It becomes `needs_owner`.
   - Insert the stocktake and the line as above.
   - Add 1 unit with a `manual_adjustment` movement, as the existing needs_owner test does.
   - Call `post_pending_counter_sale`.
   - Expect `posted_after_count === true`.
3. **A cancelled count does not flag.**
   - Same as test 1, but set the stocktake's `status` to `'cancelled'` before the void.
   - Expect `posted_after_count === false`.

Cleanup: set every stocktake these tests created to `status: 'cancelled'` at the end of each test,
so no draft is left behind on the shared database. Do not delete rows: the ledger and snapshots
reference them.

If a stocktake insert is refused (a trigger, a CHECK or a NOT NULL you did not expect), read the
migration that refuses it. Satisfy it with the minimum columns. Do not change the migration.

## 3. Counter screen E2E at phone and desktop width, with a keyboard-wedge scanner

**The page.**
- `artifacts/store/src/pages/admin/CounterPage.tsx` and
  `artifacts/store/src/components/admin/counter/LookupBox.tsx`.
- The lookup input focuses itself on mount and takes focus back after every blur.
- Its accessible name is `Barkod və ya məhsul adı`.
- Enter triggers `GET /admin/counter/lookup?q=`, which first matches the `variant_barcodes`
  table exactly.
- One match adds the line. Scanning the same variant again adds `pack_quantity` to that line.
- Payment buttons are `role="radio"`: `Nağd`, `Kart`, `Digər`.
- The submit button is `Tamamla`.
- On success, a `role="status"` paragraph reads `Satış #<n> tamamlandı.` with a `Qəbz` link to
  `/admin/counter/receipt/<id>`.
- The page labels are Azerbaijani literals, not i18n keys.

**Do this.** New file `artifacts/store/tests/e2e/counter-sale.spec.ts`:

- **Setup.**
  - Sign in exactly as `tests/e2e/admin-panel.spec.ts` does: the phone `+994550000001`, OTP
    `999999`, the same locale-agnostic selectors.
  - Copy that login block into a local function in the new file. Do not edit `admin-panel.spec.ts`.
- **Data.**
  - In `test.beforeAll`, create the product with a service client. Use
    `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`; these are set at job
    level in CI. If either is missing, throw an error naming the variable.
  - Reuse `createStockedVariant` from `../../../api-server/tests/helpers/stocked-variant` by relative
    import. The store tsconfig only covers `src/`, and Playwright transpiles the spec itself.
  - Give it on-hand 5 and price 4. It already sorts the product after every real one, so storefront
    E2E is unaffected.
  - Then insert one `variant_barcodes` row:
    - `barcode`: a unique digit string, e.g. `"299" + Date.now()`;
    - `source: "internal"`.
  - The actor for the opening balance is the admin user, looked up by phone in `users`.
- **The test**, run twice: once in a `describe` with `test.use({ viewport: { width: 1280, height: 800 } })`
  and once with `{ width: 375, height: 812 }`.
  - Create a fresh variant per run so the two runs do not share stock.
  - Steps:
    1. `page.goto("/admin/counter")` and wait for the heading `Kassa`.
    2. Scan without clicking the input, as a wedge scanner does: `page.keyboard.type(barcode)`,
       then `page.keyboard.press("Enter")`. This proves the input has focus on load.
    3. Wait for the line to appear, then scan the same barcode again the same way. This proves
       focus came back.
    4. Expect one cart line with quantity 2, and the total `8.00 AZN`.
    5. Click `Nağd`, then `Tamamla`.
    6. Expect the status text to match `/Satış #\d+ tamamlandı\./`.
    7. With the service client, expect:
       - the newest `counter_sales` row whose line uses this variant to have status `posted` and
         `total_amount` 8;
       - the variant's `on_hand` to be 3.
    8. Click `Qəbz` and expect the receipt page to show `8.00`.
  - Phone run only: before clicking `Tamamla`, assert the page does not scroll sideways:
    `document.documentElement.scrollWidth <= window.innerWidth`.
- If a selector above does not match what the page renders, read the component. Use what it
  actually renders, and note the difference. Do not change the component to fit the test.
- Do not use `waitForLoadState("networkidle")`. The note at the top of `admin-panel.spec.ts`
  explains why.

---

## Definition of done

- These pass locally:
  - `pnpm run typecheck`;
  - `pnpm run audit:invariants:strict`;
  - `pnpm run test:unit`.
- `git diff main...HEAD --stat` touches only these files, and nothing else:
  - `prompts/m3a-test-gaps.md` (already committed);
  - `artifacts/api-server/tests/serial/m3a-negative-stock.serial.test.ts`;
  - `artifacts/api-server/vitest.config.serial.ts`;
  - `artifacts/api-server/vitest.config.ts`;
  - `.github/workflows/test.yml`;
  - `artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts`;
  - `artifacts/store/tests/e2e/counter-sale.spec.ts`;
  - `docs/audits/m3-implementation-notes.md`;
  - `docs/audits/m3a-test-gaps-notes.md`.
- In `docs/audits/m3-implementation-notes.md`, replace the three bullets under "Not covered by a
  test" with one line each naming the test that now covers it. Leave the rest of the file alone.
- `docs/audits/m3a-test-gaps-notes.md`: what you wrote for each item, any selector or column that
  differed from this prompt, and the **real** output of the three commands above. Paste the real
  output, not a summary.

You cannot run the integration, serial or E2E tests: they need Supabase credentials, a running API
server and a store dev server, and those exist only in CI. Do not claim they pass. Say plainly
which tiers you ran.

Do not run anything against any remote Supabase project. Do not touch `.env`. Do not push.
