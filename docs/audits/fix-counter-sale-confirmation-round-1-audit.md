# Audit: fix/counter-sale-confirmation (round 1 re-audit)

- Date: 2026-11-16
- Branch audited: `fix/counter-sale-confirmation`, whole branch as it would merge (`git diff origin/main...origin/fix/counter-sale-confirmation`)
- Commit audited: `8b0fdea`
- Audit branch: `audit/counter-sale-confirmation-round-1`
- Previous audit: `docs/audits/fix-counter-sale-confirmation-audit.md` on `audit/counter-sale-confirmation` (9 findings)
- Method: static read of every changed file at `8b0fdea`, the API route, `post_counter_sale`, the shared pricing module, the generated Zod schema, `postgrest-js` error handling in `node_modules`, and the existing E2E spec; plus the three offline commands below. Nothing was run in a browser. The builder notes were not used as evidence (only grepped to see whether the E2E breakage was reported; it was not).
- All `file:line` references are to the tip `8b0fdea`.

## Verdict

FIX - the nine original findings are fixed as written, but the branch breaks the existing counter E2E spec without saying so (finding 1), the always-refocusing lookup box takes focus away from the two new typed fields (finding 2), and a 5xx after a committed sale still ends in the original 409 loop (finding 3).

## Status of the 9 original findings

| # | Original finding | Status | Evidence |
|---|---|---|---|
| 1 | Network-error retry not frozen, cannot replay | Fixed for a lost response. Residual hole for 5xx: new finding 3 | `CounterPage.tsx:34` (`soldAtRef`), `:78` (`??=`), `:85` and `:106` (reset on rejection and on success only), `:108-111` (catch keeps `pending`), `:114-117` (resend calls `complete()`), `CounterCheckoutPanel.tsx:114,117` |
| 2 | Quantity input truncates fractions, fires on no-op | Fixed on commit; a weaker form remains on the keystroke path: new finding 8. Fractional `pack_quantity` deliberately left | `counter-input.ts:19-28`, `CartLines.tsx:23-33`, `:42-48` |
| 3 | Hard-coded strings, no `t()` | Fixed in the seven named files | 82 distinct `Admin.Counter.*` keys used, all present in `az.ts`, `ru.ts`, `en.ts` `:1113-1197`; no non-ASCII literal left in the seven files; `ReceiptModal.tsx:20,59,130` use `locale` |
| 4 | Receipt change from client total | Fixed. Tender not stored server-side: deliberately left | `CounterPage.tsx:91-95`, `:101`; `ReceiptModal.tsx:154-166` |
| 5 | No unit test, three change calculations | Fixed. No upper bound on tender: deliberately left | `counter-input.ts:1-17`, used at `CounterPage.tsx:92,122` and `PaymentConfirmationModal.tsx:38`; `__tests__/counter-input.test.ts` |
| 6 | Lookup box fights the modal for focus | Fixed for the two modals by `disabled` (not confirmed in a browser). The same blur handler now breaks the new fields: new finding 2 | `CounterPage.tsx:132`, `LookupBox.tsx:76` |
| 7 | Receipt modal shows a stale sale / loads forever | Fixed. An out-of-order race remains: new finding 6 | `ReceiptModal.tsx:42-44`, `:52-56`, `:64-67`, `:72`, `:88-100` |
| 8 | File over 200 lines, duplication | Fixed | `PaymentConfirmationModal.tsx` is 199 lines, `.map` at `:79`; `CounterCheckoutPanel.tsx:1-2` (no `Link`); `Outcome` once at `types.ts:38` |
| 9 | Accessibility gaps | Fixed. Arrow keys on the radios: deliberately left | `ReceiptModal.tsx:83-85`, `PaymentConfirmationModal.tsx:75-78`, `CartLines.tsx:41,95,103,108` |

## Retry / idempotency path, traced

Server facts: the hash is `md5(JSON.stringify(body))` of the Zod-parsed body (`counter-sales.ts:84`), so it covers `id`, `sold_at`, `payment_method`, `owner_discount`, `displayed_total` and `lines`, in schema key order (`lib/api-zod/src/generated/api.ts:1038-1051`). `post_counter_sale` replays on same id + same hash (`20261113231200_m4_post_counter_sale_unified.sql:28-34`, and `:75-81` for a concurrent duplicate) and raises `ST020` on same id + other hash (`:30-32`), which the route maps to 409 (`counter-sales.ts:26`).

Is the body deterministic between two sends? Yes, while the cart is frozen. Key order is fixed by the object literal (`CounterPage.tsx:77-81`) and again by Zod; `sold_at` is the stored ref; numbers are plain JSON numbers with no arithmetic between sends; `displayed_total` is `priced.total_amount`, a memo over `lines`, `bundles`, `ownerDiscount`, `isOwner` (`:46-50`), all of which are frozen or load once; `owner_discount` is `Number(ownerDiscount) || 0` of a disabled field (`CounterCheckoutPanel.tsx:54`). The one way the body changes under a frozen cart is finding 4.

| Sequence | What the cashier sees | What the database holds |
|---|---|---|
| Response lost, resend unchanged | "Bağlantı xətası…" with the button "Yenidən göndər"; cart, discount, payment and tender disabled. Resend returns 200 `replayed: true`; the receipt modal opens with the right change | One sale, `sold_at` of the first attempt. Correct |
| Request never reached the server, resend | Same as above; the resend is a fresh 201 | One sale. Correct |
| Response lost, then the page is reloaded | An empty till with a new `saleId` (`:29`) and no trace of the attempt. Nothing warns before unload | The sale may be posted. If the cashier rings it again it is a second sale with a new id and stock is decremented twice. Finding 5 |
| 4xx rejection, cashier edits the cart, resends with the same id | Server error text, cart unfrozen (`:84-90`), `sold_at` reset; next confirm is a fresh insert | Nothing from the rejected attempt (validation fails before the RPC, a raised RPC rolls back). One sale after the resend. Correct |
| 5xx from the API after the RPC committed | Raw error text, cart unfrozen; every later confirm answers 409 `ST020`; the id never rotates | One sale the cashier cannot see from the till. Finding 3 |
| Double click on confirm | Second click hits a disabled button (`PaymentConfirmationModal.tsx:52,188`). If two requests did go out they share id, `sold_at` and body | One sale; the second request replays. Correct |
| Double click on "Yenidən göndər" | First click sets `outcome` to `null` (`:73`), which disables the button (`CounterCheckoutPanel.tsx:114`). No progress indicator is shown during the resend | One sale. Correct |
| Modal closed while pending | Not possible: `onOpenChange` and Cancel are guarded by `pending` (`PaymentConfirmationModal.tsx:55,180`). After a network error the modal is closed by the code and the panel shows the resend button | n/a |
| Payment method changed between attempts | After a network error both radio groups are disabled (`CounterCheckoutPanel.tsx:73`; the modal is closed). After a 4xx it can be changed, and nothing is in the database, so it is a fresh insert | Correct |
| Owner discount | Field disabled while pending (`CounterCheckoutPanel.tsx:54`). A staff session sends 0 (`:79`) and the server ignores it anyway (`counter-sales.ts:67`). A negative value is a 400 from Zod (`api.ts:1043`, min 0) shown as the raw text "Invalid sale"; a value above the total is clamped the same way on both sides (`lib/counter-pricing/src/index.ts:94`) | Correct |

## Findings

### 1. Major - the existing counter E2E spec no longer matches the UI and the branch neither updates nor reports it: `artifacts/store/tests/e2e/counter-sale.spec.ts:71`, `:82-85`, `:104-106`

The diff touches no file under `artifacts/store/tests/`. The spec runs in CI (`.github/workflows/test.yml:150-151`, `artifacts/store/playwright.config.ts:15`).

- `:71` expects the quantity in `li span.tabular-nums`. The quantity is now an `<input type="number">` (`CartLines.tsx:36-58`); no `span.tabular-nums` is left inside a cart `li`.
- `:82-85` clicks "Tamamla" and expects `role=status` to read "Satış #N tamamlandı.". The click now only opens the confirmation modal (`CounterPage.tsx:119`), and with "Nağd" selected (`:75` of the spec) confirm stays disabled until a tender is typed (`PaymentConfirmationModal.tsx:52`).
- `:104-106` clicks a link named "Qəbz" and expects `#receipt`. The link is now a button "Qəbzə bax" (`CounterCheckoutPanel.tsx:129-135`, `az.ts:1148`) that opens `#inpage-receipt` (`ReceiptModal.tsx:124`), and the receipt modal is already open over the page.

Scenario: merge the branch; the `integration-e2e` job fails on both viewport tests. Not run here (no credentials); read from the spec and the components. AGENTS.md: "If a test breaks, fix the cause or report it."

Fix: update the spec to the new flow without weakening it: assert the quantity with `getByRole("spinbutton", { name: "Miqdar" })` `toHaveValue("2")`, fill the tender in the modal and confirm, keep the database assertions, assert `#inpage-receipt` contains `8.00`.

### 2. Major - the lookup box takes focus back from the new quantity field and the new tender field: `LookupBox.tsx:76`, `CartLines.tsx:36-58`, `CounterCheckoutPanel.tsx:89-98`

`onBlur` re-focuses the lookup input after 0 ms whenever it is not `disabled`. Round 1 disabled it for the two modals only. In the normal cart state it is enabled and (by design) always focused, so any other input on the page loses focus right after getting it.

Scenario: one line with quantity 1. The cashier clicks the quantity field to type 12. Mousedown blurs the lookup box, its timer fires, the lookup box is focused again, the quantity field blurs and `commit()` runs with no change. The digits "12" land in the lookup box; Enter runs a lookup for "12" and may add an unrelated product. The same happens to the "Təqdim edilən məbləğ" field in the side panel, and with Tab instead of the mouse. Derived from DOM focus order, not run in a browser; this is the first thing to confirm in one. The owner-discount field (`CounterCheckoutPanel.tsx:49-57`) and the `PickupPanel` input have the same exposure on `main`; the two fields above are new in this branch.

Fix: in `onBlur`, refocus only when focus went nowhere useful, for example `if (!disabled && !(e.relatedTarget instanceof HTMLInputElement))`.

Side effect in the same file: the reset effect at `LookupBox.tsx:25-31` lists `disabled` in its dependencies, so typed text and the "Tapılmadı" message are cleared every time a modal opens or closes, not only when `resetSignal` changes.

### 3. Major - a 5xx after the sale committed still ends in the round-0 409 loop: `CounterPage.tsx:84-90`, `counter-sales.ts:29-31`, `:87-91`

Every non-2xx response with a JSON body is treated as a rejection: `sold_at` is reset, the cart is unfrozen, the id is kept. That is right for a 4xx. It is wrong for a 500, whose outcome is unknown. The route answers 500 for any RPC error without a mapped code (`counter-sales.ts:30`), and `postgrest-js` turns a failed or timed-out fetch into such an error object instead of throwing (`node_modules/.pnpm/@supabase+postgrest-js@2.105.4/node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:371-427`).

Scenario: the cashier confirms a 19.00 AZN sale. The RPC commits, but the API loses the answer from Supabase (gateway timeout while the function waited on a row lock, or a dropped connection). The API returns 500 `{"error":"TypeError: fetch failed"}`. The till shows that text and unfreezes. The cashier confirms again: new `sold_at`, different hash, `ST020`, 409 "Counter sale <uuid> already exists with a different payload". Every further attempt is the same 409 because `saleId` only rotates on success (`:105`). The database holds one posted sale; the cashier believes nothing was sold and, after a reload, rings it a second time. Not reproduced; read from the three files.

Fix (client only): treat `res.status >= 500` like the `catch` branch (keep `pending` and `soldAtRef`, offer resend). On a 409 with `code === "ST020"` show a translated "this sale is already recorded, check the sales list" text and rotate `saleId`.

### 4. Minor - a lookup answer that arrives late changes a frozen cart and removes the resend button: `CounterPage.tsx:52-54`, `:132`; `LookupBox.tsx:39-45`; `CounterCheckoutPanel.tsx:114`

`disabled` stops typing, not a request already in flight; `addItem` has no `pending` guard and calls `setOutcome(null)`.

Scenario: on a slow connection the cashier scans the last item, opens the modal and confirms before the lookup answers. The POST fails with a network error (frozen, "Yenidən göndər"). Then the lookup answers: a line is added to the frozen cart and `outcome` becomes `null`, so the button is disabled (`pending && outcome?.kind !== "error"`) with no way out but a reload. If the lookup answers before the error instead, the resend carries a different cart and gets `ST020` when the first POST had committed. If the POST succeeds, `setLines([])` (`:102`) silently drops an item that was scanned but not sold.

Fix: return early from `addItem` and `setPicker` when `pending || showConfirm`.

### 5. Minor - an unknown outcome does not survive a reload, and nothing warns before one: `CounterPage.tsx:29`, `:34`, `:108-111`

`saleId`, `soldAtRef` and the cart live only in component state. While `pending` with a network error the only actions are resend, reload, or the "Satışlar" link (`:130`), and the last two discard the id.

Scenario: the response is lost, the network stays down for a minute, the cashier reloads. The till is empty with a new id. The sale may be posted; ringing it again creates a second sale and a second stock decrement. Fix (simple): a `beforeunload` prompt while `pending`; or keep `{ saleId, soldAt, body }` in `sessionStorage` until the outcome is known.

### 6. Minor - the receipt fetch is never cancelled: `ReceiptModal.tsx:40-68`

The effect has no cleanup, so a slow answer for an earlier `saleId` still runs its `then`/`catch`.

Scenario: receipt A is opened and closed while its request hangs; sale B completes and its receipt loads; then A's answer arrives. `s.id === saleId` at `:52` compares against A's own closure, so `setSale(A)` overwrites B. `isCurrentSale` (`:72`) is false, `loading` is false, `error` is false: the modal shows "Qəbz məlumatları yüklənir…" for good. If A fails instead, B's loaded receipt is replaced by the error text. A wrong sale is never rendered (the guard at `:72` holds).

Related: the public `/site-settings` request is inside the same `Promise.all` (`:50`), so a network failure on the shop name alone turns a successfully loaded sale into the error state (`:64-67`).

Fix: `let cancelled = false` with a cleanup, check it before every `set…`; give the settings request its own `.catch(() => null)`.

### 7. Minor (needs a browser; major if confirmed) - receipt print and overflow: `ReceiptModal.tsx:77`, `:104-118`; `components/ui/dialog.tsx:39`

- The print rule places `#inpage-receipt` with `position: fixed; left: 0; top: 0`. Its ancestor `DialogContent` is translated by -50%/-50% (`dialog.tsx:39`), and a transformed ancestor is the containing block for fixed descendants. The receipt is therefore placed at the dialog's corner, which is centred on the page, not at the paper's top-left. The older page uses `position: absolute` under no transformed ancestor (`pages/admin/CounterReceiptPage.tsx:43`).
- `width: 80mm !important` plus 8 px padding is wider than the printable width of an 80 mm roll; the right-aligned prices are the part that would be cut.
- `DialogContent` gets only `max-w-md` (`:77`): no max height, no scrolling.

Scenario: a sale with about 25 distinct lines on a 1366x768 till. The centred dialog is taller than the viewport, so the top (shop name, sale number) and the bottom (the "Çap et" and "Yeni Satış" buttons, `:172-189`) are off-screen and cannot be scrolled to; only Escape closes it. On paper the top of the same receipt starts above the page edge. To confirm: Chrome print preview with paper width 80 mm for a 3-line and a 25-line sale.

Fix: `max-h-[90vh] overflow-y-auto` on the `DialogContent`; in the print rule reset the dialog (`position: static`, `transform: none`, `translate: none`) and use `position: absolute` and `width: 100%` for the receipt.

### 8. Minor - the keystroke path still commits a prefix of what is typed; the buttons have no upper bound: `CartLines.tsx:42-48`, `:23-33`, `:104`

Scenario: a line has quantity 7. The cashier selects the field and types "2.5". The first keystroke calls the parent with 2; "2.5" is rejected by `parseQuantity`; on blur the field resets to `String(quantity)`, which is now 2. The cart bills 2, not 7, and no message says the input was refused. This is what is left of original finding 2 ("says so by rejecting other input" in the round prompt). (Moot until finding 2 of this audit is fixed, because the field cannot keep focus.)

Also: the field caps at 9999, but "+" (`:104`) and repeated scans (`CounterPage.tsx:57`) do not; above 10000 the API answers 400 "Invalid sale" (`lib/api-zod/src/generated/api.ts:1030,1047`).

Fix: call the parent only from `commit()` (blur and Enter), so a rejected entry returns to the quantity that was there; disable "+" at 9999.

### 9. Minor - the false stock warning for non-tracked variants is carried into the new UI: `CartLines.tsx:82`, `:116`; `CounterPage.tsx:68`

Not introduced by this branch (the logic is unchanged from `main`; the branch translated the text at `:116`), listed because the task asked for every read of `on_hand`/`available`.

- `CartLines.tsx:82`: `overOnHand = total > line.on_hand` ignores `available === null` (non-tracked, `types.ts:12,33`). `:83` handles `null` correctly.
- `CounterPage.tsx:68`: `addBundle` sets `available: l.on_hand` and drops the `track_stock` and `available` the bundle line already carries (`types.ts:22`).
- `CounterPage.tsx:60` and `:138` handle `null` correctly.

Scenario: a non-tracked variant (a service, `on_hand` 0) is scanned. The cart shows "Sistemdə 0 ədəd var. Satış qeyd olunacaq, sahibkar stoku yoxlamalıdır." The server writes no movement for it (`20261113231200_m4_post_counter_sale_unified.sql:120`), so the sale posts normally and the warning is false. Fix: `line.available !== null && total > line.on_hand`, and pass `available: l.available ?? l.on_hand` in `addBundle`.

### 10. Minor - translation leftovers

- `CounterSalesPage.tsx:80` uses `Admin.Counter.cancel` for the void action. Azerbaijani "Ləğv et" fits both uses; English "Cancel" and Russian "Отмена" (`en.ts:1161`, `ru.ts:1161`) read as "dismiss" on a destructive link, while the prompt it opens says "Void sale" / "Аннулировать продажу" (`:1182`). Scenario: an English-locale owner sees a red "Cancel" beside each sale. Fix: a separate `voidSale` key.
- `Admin.Counter.available` (`az.ts:1122`, `ru.ts:1122`, `en.ts:1122`) is defined and used nowhere.
- Server error text is shown untranslated: `CounterPage.tsx:88` (`data.error`), `CounterSalesPage.tsx:62,102`. A Russian-locale cashier sees "Invalid sale" or the `ST020` sentence. Present on `main` too; the API was out of scope.
- Product titles in the cart come from the lookup route, which picks `az` (`artifacts/api-server/src/routes/admin/counter-lookup.ts:71`), while the receipt picks the UI locale (`ReceiptModal.tsx:20`). A Russian-locale cashier sees the Azerbaijani title in the cart and the Russian one on the receipt for the same line. API out of scope; recorded.

Otherwise the Russian and English texts say the same as the Azerbaijani ones (`:1114-1196` compared line by line), and every placeholder is replaced where used: `{saleNumber}` (`CounterPage.tsx:99-100`, `CounterSalesPage.tsx:66`), `{n}` (`CounterPage.tsx:138`, `CartLines.tsx:116`), `{reservations}` (`CartLines.tsx:122`), `{amount}` (`PaymentConfirmationModal.tsx:131,166,172`), `{tendered}`/`{total}` (`:152`), `{count}` (`CounterSalesPage.tsx:97`), `{charged}`/`{list}` (`:126`).

### 11. Minor - the fix this round existed for has no automated test

`__tests__/counter-input.test.ts` covers the two pure functions only. Nothing tests that a resend carries the same `sold_at`, that the catch keeps `pending`, or that a rejection resets it. Scenario: a later edit moves `soldAtRef.current = null` into the `catch`; typecheck, all 749 unit tests and the invariants still pass, and the 409 is back. Fix: move the body construction into a small pure helper next to `computeChange` (id, `sold_at` in, body out) and test it, or one component test with a mocked `adminFetch` that rejects then resolves and asserts two identical request bodies.

## Are the new unit tests meaningful

Yes for what they cover; they would fail on the realistic wrong implementations:

- `computeChange("0.3", 0.1)` equals exactly `0.2`: fails on plain float subtraction.
- `("19", 19)` sufficient: fails on `>` instead of `>=`.
- `""` and `"abc"`: fail if `Number("")` (0) or `NaN` leaked through.
- `parseQuantity("2.5")`, `"1e9"`, `"0"`, `"-1"`, `"10000"`, `"9999"`: fail on `parseInt`, on a missing bound, or on an off-by-one bound.

Gaps: the insufficient case asserts only `sufficient`, not `change: 0` (`:14-17`, `:31`), so a negative change there would pass; no case where rounding decides sufficiency (for example `("19.994", 19.99)`); `"1e3"` and `" 5 "` are accepted as 1000 and 5 and neither is pinned; no test above the function level (finding 11).

## Confirmed correct

- The float comparison `serverTotal === priced.total_amount` (`CounterPage.tsx:95`): both sides are a whole number of qəpik divided by 100 (`lib/counter-pricing/src/index.ts:35,102`; `numeric(12,2)` through `counter_sale_json`, `20261111120400_m3_post_counter_sale.sql:15`), so they are the same double when the totals agree. When they differ the receipt prints the tender and no change line.
- `computeChange` works in whole qəpik and returns 0 change when insufficient (`counter-input.ts:12-16`). Card and "other" send no tender to the receipt (`CounterPage.tsx:94`).
- `priceCounterSale` cannot throw in the client memo: its two throws (`index.ts:73,79`) need a bundle id the client does not have, and bundle lines are only ever created from the client's own list (`CounterPage.tsx:66-69`). Editing the quantity of a bundle line only changes the number of complete sets (`index.ts:84`).
- `parseQuantity` on commit: empty, zero, negative, fractional and out-of-range input reset the field and do not call the parent (`CartLines.tsx:23-33`). A fractional line quantity from a barcode pack is left untouched by a blur.
- Stale receipt: `setSale(null)` at the start of each load and the `isCurrentSale` guard (`ReceiptModal.tsx:42,72,99`) prevent rendering a sale under another id.
- i18n: `t` is typed by `TranslationKey` (`lib/i18n/context.tsx:6`), so a missing key fails typecheck; the scripted comparison found 82 used keys, 83 defined in each dictionary, identical key sets in all three.
- Files over 200 lines: none (`PaymentConfirmationModal.tsx` 199, `ReceiptModal.tsx` 195, `CounterPage.tsx` 191).
- `as any`, `@ts-ignore`, `@ts-expect-error`, `.skip(`, `eslint-disable`: none added under `artifacts/` (`git diff origin/main...HEAD -G` matches only the prompt file). No test file deleted or changed.
- No change under `artifacts/api-server/` or `supabase/` in the branch diff.

## Ran

In the audit worktree on `audit/counter-sale-confirmation-round-1` (code identical to `8b0fdea`), after `pnpm install --frozen-lockfile --prefer-offline` (exit 0).

`pnpm run typecheck` - exit 0:

```
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

`pnpm test:unit` - exit 0:

```
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 36ms
 ✓  store-unit  src/__tests__/checkout-form-security.test.ts (1 test) 98ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 146ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 190ms

 Test Files  68 passed (68)
      Tests  749 passed (749)
   Start at  13:49:11
   Duration  25.06s (transform 16.03s, setup 0ms, collect 49.55s, tests 32.76s, environment 23.01s, prepare 66.83s)
```

`pnpm run audit:invariants` - exit 0:

```
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new
ok    no-non-tracked-variant-movements 0 total, 0 new
ok    signals-have-one-derivation      0 total, 0 new
ok    no-undispatched-notification-type 0 total, 0 new

All invariant checks passed.
```

## Not checked

- The `api-integration`, `env-validation` and Playwright E2E tiers were not run (no Supabase credentials, no running API). Finding 1 is read from the spec, not observed as a red run. Findings 3 and 4 are traced through the code, not reproduced.
- Nothing was run in a browser. A browser is needed to confirm:
  - finding 2: click and Tab into the quantity field and the side-panel tender field with the lookup box focused; watch `document.activeElement`;
  - finding 7: print preview at 80 mm for a short and a long receipt; a 25-line receipt on a 768 px high screen;
  - original finding 6: scanner keystrokes while each modal is open, and where focus lands after the receipt modal and the confirm modal close;
  - `autoFocus` on the tender input inside the Radix dialog (`PaymentConfirmationModal.tsx:112`);
  - what `e.target.value` is for a half-typed "2." in `type=number`, and comma decimals in non-Chrome browsers;
  - the Radix console warnings for the two dialogs.
- `VariantPicker.tsx:15,35`, `PickupPanel.tsx:31-64` and `pages/admin/CounterReceiptPage.tsx:16-63` still hold hard-coded Azerbaijani text. They render on or beside the till but are outside the seven files the round named, so they are not counted as findings.
- Whether `modern-web-guidance` was consulted before the UI work cannot be seen from git.
- The deliberately left items were not re-examined: arrow keys on the radios, tender not stored server-side, no upper bound on the tender input, fractional `pack_quantity` reaching the API, the API route and the SQL.
