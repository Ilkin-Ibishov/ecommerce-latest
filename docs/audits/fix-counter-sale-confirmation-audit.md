# Audit: fix/counter-sale-confirmation

- Date: 2026-11-15
- Branch audited: `fix/counter-sale-confirmation`
- Commit audited: `19a6dd8` ("fix(counter): add sale confirmation modal, change calculator, direct quantity input and receipt modal"), one commit on `main`
- Audit branch: `audit/counter-sale-confirmation`
- Method: static read of `git diff main...fix/counter-sale-confirmation` and the surrounding files, plus the three offline commands below. Nothing was run in a browser.

## Verdict

Approved after the listed fixes: the retry/idempotency path regressed (finding 1) and the quantity input silently truncates fractional quantities (finding 2); the i18n gap (finding 3) breaks the house rule.

## Findings

### 1. Blocker - network-error retry is no longer frozen and cannot replay: `artifacts/store/src/pages/admin/CounterPage.tsx:76`, `:102-106`, `:109-115`

Two defects that combine.

a) The `catch` branch (lines 102-106) now calls `setPending(false)` and `setShowConfirm(false)`. On `main` the catch deliberately kept `pending` true so the cart stayed frozen and "Retry resends the same id". Now every error path sets `pending=false`, so the `pending && outcome.kind === "error"` branches at line 110 and in `CounterCheckoutPanel.tsx:120,123` ("Yenidən göndər") are dead code. The cart, owner discount and payment method are editable after an unknown outcome.

Scenario: the cashier confirms a 19.00 AZN sale, the POST reaches the server and commits, the response is lost. The UI shows "Nəticə məlum deyil", unfrozen. The cashier adds one item and confirms again with the same `saleId`. `post_counter_sale` sees the same id with a different payload hash and raises `ST020` (migration `20261113230400`, lines 22-26), so the cashier gets a 409 and the id never rotates. The original sale is posted with the old cart, and the screen offers no way to see it.

b) Even an unedited retry cannot replay. `complete()` puts `sold_at: new Date().toISOString()` in the body at line 76 on every call, and the API hashes `JSON.stringify(body)` (`counter-sales.ts:84`). A resend therefore hashes differently, and the replay path (`replayed: true`) is unreachable from this UI. This part exists on `main` too, but the diff's retry path depends on it and leaves it broken.

Fix: generate `sold_at` once per `saleId` (state next to `saleId`), keep `pending` true and the cart frozen after a network error, and route the retry through `complete()` directly as `main` did.

### 2. Major - quantity input silently truncates fractional quantities: `artifacts/store/src/components/admin/counter/CartLines.tsx:20-29, 40`

`commit()` runs `parseInt` on blur and Enter, and it calls `onChange(parsed)` even when the user changed nothing. The quantity column is `numeric(12,3)`, and `item.pack_quantity` is a number that can be fractional.

Scenario: a line has quantity 2.5 (for example from a kg pack). The cashier clicks into the field and tabs out. `parseInt("2.5")` is 2, so `onChange(2)` fires and the cart now bills 2. Typing "1.5" also commits 1 on the first keystroke path (line 40-43) and is reset to "1" on blur. There is no message. A line with quantity below 1 (0.5) is reset to its previous value, so it cannot be edited at all.

Related fact: the API rejects non-integer quantities (`counter-sales.ts:35`, "quantities must be whole"), so the till cannot sell fractional units today. The truncation hides that mismatch instead of surfacing it. Either keep the field integer-only and drop `pack_quantity` fractions on add, or parse with `Number`, allow up to 3 decimals and fix the API.

Other inputs checked: empty, zero, negative, letters, and a comma decimal (Chrome yields `""` for `type=number`) all reset to the previous value on blur. That is correct. There is no upper bound: "99999999999" is accepted and overflows `numeric(12,2)` at post time, so the cashier sees a generic server error (minor, same area).

### 3. Major - hard-coded user-visible strings, no `t()`, no keys in any dictionary: all new components

The diff touches none of `lib/i18n/messages/{az,ru,en}.ts`. Roughly 60 new Azerbaijani literals, for example `PaymentConfirmationModal.tsx:203,205,212,221,237,252,267,277,303,319,324,330,338,344,356,365`, `CounterCheckoutPanel.tsx:48,54,67,72,85,94,108,110,123,140`, `ReceiptModal.tsx:17,20,66,71,98,100,102,117,121,124,128,133,139,150,158`, `CartLines.tsx:37,68,86,90,98,103,111,117`, `LookupBox.tsx` aria-label "Axtarışı təmizlə", `CounterSalesPage.tsx` "Əməliyyatlar". Violates AGENTS.md and `.agents/rules/frontend.md` ("zero hardcoded strings").

Scenario: a Russian-locale owner opens the till; the confirmation modal, receipt and change calculator are all Azerbaijani. The receipt is also locale-dependent in that it hard-codes `"az-AZ"` and the `az` product title (`ReceiptModal.tsx:20,101`).

`i18n-hardcoded-strings.test.ts` does not catch this: it only checks 15 fixed section names (Footer, Cart, and so on). The older counter files on `main` already had the same debt, so the diff adds to it rather than introducing it.

### 4. Major - receipt change is computed client-side from the client total, while the receipt total comes from the server: `CounterPage.tsx:88-90`, `ReceiptModal.tsx:122,125-135`

`finalChange = tendered - priced.total_amount` (client pricing). The receipt prints `sale.total_amount` (server pricing) next to that change. They normally match because both use `priceCounterSale`, but the server re-prices from the live `bundles` rows (`counter-sales.ts:46-67`) and the DB flags `total_mismatch` exactly for the case where they differ.

Scenario: an owner edits a bundle price after the till page loaded. The screen showed 19.00 and the cashier gave change against 20 tendered = 1.00. The server posts 18.00. The receipt prints CƏMİ 18.00, Ödənildi 20.00, Qalıq 1.00, which does not add up, and the till gave 1.00 instead of 2.00. Fix: use `data.total_amount` from the POST response for the change, and do not print a change line when it disagrees with `displayed_total`.

Confirmed related: tendered and change are not sent to the API or stored (`counter_sale_payments` has only `method` and `amount`), and `onViewReceipt` at line 160 drops them, so reopening "Qəbzə bax" prints a different receipt (no Ödənildi/Qalıq lines) than the first print.

### 5. Minor - no unit test for new pure logic

No test files are in the diff. Untested: the change calculation, which exists three times with three different roundings (`CounterPage.tsx:117-119` unrounded, `PaymentConfirmationModal.tsx:179-183` `Math.round(x*100)/100`, `CounterPage.tsx:88-90` `Math.max(0, ...)` unrounded), and the quantity parser (`CartLines.tsx:20-29`). Scenario: a future edit changes one copy and the panel, modal and receipt show different change for the same tender. Fix: one pure `computeChange(tendered, totalQ)` working in whole qəpik (the same unit as `lib/counter-pricing`), used by all three, with a Vitest file.

Also the tender input accepts any number: `type=number min=0` is only a hint and "1e9" passes; there is no max.

### 6. Minor - possible focus fight between `LookupBox` and the confirmation modal: `LookupBox.tsx:74`, `CounterPage.tsx:128`

`LookupBox` is disabled only on `pending || picker`, not while `showConfirm` is true, and its `onBlur` re-focuses the lookup input after 0 ms. When Radix moves focus into the modal, the page input blurs and tries to steal focus back while the Radix focus scope pulls it into the dialog. Not confirmed without a browser. What would confirm it: open the modal with the scanner box focused and watch `document.activeElement` and keystrokes from a scanner. Scenario if real: scanner digits land in the hidden lookup box or the tendered input loses focus (`autoFocus` at `PaymentConfirmationModal.tsx:284`). Fix: pass `disabled={... || showConfirm || !!completedReceipt}`.

### 7. Minor - receipt modal can show a stale sale: `ReceiptModal.tsx:38-54`

On a failed fetch (`r.ok` false) `sale` keeps the previous value, or stays `null` and the "loading" text shows forever.

Scenario: sale #12 receipt opened, closed; sale #13 completes; the receipt fetch returns 500; `loading` becomes false and the modal renders sale #12's lines under #13's tendered/change. Fix: `setSale(null)` at the start of the effect and show an error state when the fetch fails.

### 8. Minor - file over 200 lines without a stated reason, copy-paste: `PaymentConfirmationModal.tsx` (218 lines)

AGENTS.md deny rule; no design note or commit-message reason. The three payment buttons (lines 224-268) are the same block three times and can be a `.map`, which would bring the file under the limit. `CounterCheckoutPanel.tsx` also imports `Link` from wouter and never uses it (line 1), and re-declares the `Outcome` type that `CounterPage.tsx:16` also declares.

### 9. Minor - accessibility gaps (the basics are covered by Radix, see below)

- `ReceiptModal.tsx:61-68`: `DialogContent` with a title but no `DialogDescription` produces the Radix a11y console warning.
- `PaymentConfirmationModal.tsx:220`: a `<label>` with no `htmlFor`/control labels the radiogroup; use `id` + `aria-labelledby` on the group. The `role="radio"` buttons have no arrow-key handling.
- `CartLines.tsx:37,90,98,103`: aria-labels are hard-coded Azerbaijani (see finding 3).

## Confirmed correct

- Browser-side data access: no `supabase.from(...)` and no staff-visible cost or margin field in any changed hunk. All sale data goes through `adminFetch` to `/admin/counter/*`. The receipt reads the sale through `requireStaffOrAdmin` routes, which strip owner-only flags for staff (`counter-sales.ts:16-22`). Outside the diff, `CounterPage.tsx:39` (unchanged) reads `users.role` for the signed-in user from the browser; it only drives UI visibility, because the server ignores a staff owner discount (`counter-sales.ts:67`).
- Double submission within one attempt: the confirm button is `disabled` while `pending`, React flushes the discrete click before the next event, there is no `<form>` so Enter in the tender input does not submit, and the same `saleId` is reused on every call. The DB replays a same-id same-payload call. After success `saleId` rotates. (The retry flaw is finding 1.)
- Change maths on the confirm path: insufficient cash is blocked (`canConfirm`, `PaymentConfirmationModal.tsx:197`); NaN and empty tender are treated as insufficient; negative tender fails `>= total`; card and "other" ignore tender and send `null` tender. Rounding in the modal is to qəpik.
- What is sent versus shown: the body sends `displayed_total: priced.total_amount` from the shared pricing module and the server re-prices with the same module. Split payments do not exist in this change: one `payment_method` is sent and the sum rule in `counter_sale_payments` is enforced server-side.
- Modal a11y basics: both modals use the Radix `Dialog` in `components/ui/dialog.tsx`, which gives a focus trap, Escape to close, `aria-labelledby` from `DialogTitle` and focus return to the trigger. The confirm modal blocks close while `pending`. Tender input has `htmlFor`/`id`.
- House rules grep on the diff: no `as any`, `@ts-ignore`, `.skip(` or lint-disable; no test file deleted or weakened (the diff contains no test file).
- `LookupBox` `resetSignal` and Escape-to-clear logic reads correctly.

## Ran

All run in the audit worktree on `audit/counter-sale-confirmation` (identical code to `19a6dd8`), after `pnpm install --frozen-lockfile` (exit 0).

- `pnpm run typecheck`: exit 0. Tail: `artifacts/api-server typecheck: Done`, `artifacts/store typecheck: Done`.
- `pnpm test:unit`: exit 0. `Test Files 62 passed (62)`, `Tests 696 passed (696)`, duration 16.51s.
- `pnpm run audit:invariants`: exit 0. Tail: `ok no-client-writes-on-counter-sale-payments 0 total, 0 new`, `ok post-counter-sale-writes-payments 0 total, 0 new`, `All invariant checks passed.`

## Not checked

- Nothing was exercised in a browser: focus behaviour (finding 6), print layout of `#inpage-receipt` under `@media print`, modal stacking, and real scanner input are unverified.
- Integration and E2E tiers were not run (no Supabase credentials, by instruction); the 409 behaviour in finding 1 is read from the migration and the route, not reproduced.
- Whether `modern-web-guidance` `search` was run before the UI code was written (frontend rule) cannot be seen from git; the modals use Radix `Dialog`, not native `<dialog>`.
- Locale behaviour of `type=number` with a comma decimal differs by browser; only the Chrome behaviour was reasoned about.
- Server handling of a negative or huge `owner_discount` (`min=0` is only a hint at `CounterCheckoutPanel.tsx:57`; unchanged by this diff) was not checked.

## Merge order

`git diff --name-only main...m4/stock-signals-core` lists 47 files. Files changed by both branches:

- `artifacts/store/src/components/admin/counter/CartLines.tsx`
- `artifacts/store/src/pages/admin/CounterPage.tsx`

Not overlapping, but the fix branch depends on them: M4 also changes `components/admin/counter/types.ts` (`LookupItem`, which `CartLines`/`CounterPage` consume), `components/admin/counter/VariantPicker.tsx` and `routes/admin/counter-lookup.ts`. M4 also changes `20261113231200_m4_post_counter_sale_unified.sql` (the Postgres function behind finding 1's replay path). Nothing was resolved.
