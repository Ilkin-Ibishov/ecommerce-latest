# fix/counter-sale-confirmation — fix round 1

Read `AGENTS.md`, `.agents/rules/frontend.md` and `.agents/rules/testing.md`. Branch
`fix/counter-sale-confirmation`; it is checked out and rebased on `main` (M4 is merged). Never commit
to `main`. Do not touch any Supabase project, do not run SQL, do not add or edit a migration, do not
change anything under `artifacts/api-server/`.

An audit found nine defects in this branch (`docs/audits/fix-counter-sale-confirmation-audit.md` on
branch `audit/counter-sale-confirmation`; you do not need to read it, everything is below).
Seven changes, one commit each, in this order. Nothing else: do not restyle, do not refactor nearby code.

All paths below are under `artifacts/store/src/`. Line numbers are for the branch tip `2c78273`.

## 1. A lost response leaves the cashier with a 409 (blocker)

`pages/admin/CounterPage.tsx`:

- `:102-106` — the `catch` sets `pending` to `false`. It must not. After a network error the outcome
  is unknown: the cart, discount and payment method stay frozen and the button resends the same sale.
  In the `catch`, keep `setShowConfirm(false)` and the `setOutcome(...)`, remove `setPending(false)`.
  The `!res.ok` branch (`:82-87`) stays as it is: a rejected request unfreezes.
- `:76` — `sold_at: new Date().toISOString()` is evaluated on every call. The API hashes the parsed
  body (`artifacts/api-server/src/routes/admin/counter-sales.ts:84`), so a resend hashes differently
  and `post_counter_sale` answers `ST020` (409) instead of replaying. Fix: a `useRef<string | null>(null)`
  named `soldAtRef`; in `complete()` use `soldAtRef.current ??= new Date().toISOString()` and send that.
  Set it back to `null` in the two places the attempt ends: the `!res.ok` branch and the success path
  (next to `setSaleId(crypto.randomUUID())`). Not in the `catch`.
- `handleOpenConfirm` (`:109-115`) already calls `complete()` directly when `pending && outcome?.kind === "error"`;
  with the change above that branch is live again. Do not change it.

## 2. One change calculation, in whole qəpik, from the server's total

Today the change is computed three times with three roundings (`CounterPage.tsx:90`, `:117-119`,
`components/admin/counter/PaymentConfirmationModal.tsx:26-30`), and the receipt prints a change computed
from the client total beside the server's total.

- New file `components/admin/counter/counter-input.ts` with one pure function:
  `computeChange(tendered: string | number, total: number): { sufficient: boolean; change: number }`.
  Parse `tendered` with `Number`; not finite or empty string → `{ sufficient: false, change: 0 }`.
  Work in whole qəpik: `Math.round(x * 100)` on both, compare and subtract the integers, return
  `change` in AZN (`/ 100`). `sufficient` is `tenderedQ >= totalQ`.
- Use it in all three places. `CounterPage.tsx:117-119` becomes one call whose result feeds
  `hasValidCashTender` (`payment !== "cash" || sufficient`) and `changeAmount`. The modal's
  `isSufficient`/`changeDue` come from the same function; keep `hasTendered` as it is.
- `CounterPage.tsx:88-90` (after a successful POST): compute the receipt's change from the **server**
  total: `computeChange(tenderedAmount, Number(data.total_amount))`. `data` is the JSON of
  `counter_sale_json` and contains `total_amount` (`supabase/migrations/20261111120400_m3_post_counter_sale.sql`,
  function `counter_sale_json`). If `Number(data.total_amount)` differs from `priced.total_amount`,
  pass `change: null` to `setCompletedReceipt` so the receipt prints no change line; `tendered` is still passed.

## 3. The quantity field truncates and fires on no change

`components/admin/counter/CartLines.tsx:20-29` and `:38-44`: `parseInt("2.5")` is 2, and `commit()` calls
`onChange` even when nothing changed. The API accepts whole quantities only
(`counter-sales.ts:35`), so the field is whole-number only, and says so by rejecting other input.

- Add to `counter-input.ts`: `parseQuantity(text: string): number | null` — returns the number when
  `Number(text)` is an integer from 1 to 9999, otherwise `null` (so `"2.5"`, `""`, `"0"`, `"-1"`, `"abc"`,
  `"1e9"` are all `null`).
- `QuantityCell`: the `onChange` handler calls the parent only when `parseQuantity` returns a number
  that differs from `quantity`. `commit()` does the same, and when the result is `null` it only resets
  the text to `String(quantity)` — it does not call the parent.
- Do not change `addItem` in `CounterPage.tsx` or the `pack_quantity` handling. Record in the notes
  under *Not verified* that a fractional `pack_quantity` still reaches the API and is rejected there.

## 4. Tests for the two pure functions

New file `__tests__/counter-input.test.ts` (Vitest, same style as `__tests__/counter-pricing.test.ts`):

- `computeChange`: `("20", 19)` → sufficient, change 1; `("19", 19)` → sufficient, 0; `("18.99", 19)` →
  not sufficient; `("", 19)` and `("abc", 19)` → not sufficient, 0; `("0.3", 0.1)` → change exactly `0.2`
  (the float case); a number argument works like its string.
- `parseQuantity`: `"1"`, `"12"`, `"9999"` → the number; `"2.5"`, `""`, `"0"`, `"-1"`, `"abc"`, `"1e9"`,
  `"10000"` → `null`.

## 5. Translations for the till

None of the till's text goes through `t()`. Every user-visible literal and every `aria-label`/`placeholder`
in these seven files moves to the dictionaries:
`pages/admin/CounterPage.tsx`, `pages/admin/CounterSalesPage.tsx`, and in `components/admin/counter/`:
`CartLines.tsx`, `CounterCheckoutPanel.tsx`, `LookupBox.tsx`, `PaymentConfirmationModal.tsx`,
`ReceiptModal.tsx`. That includes the `Outcome` texts built in `CounterPage.tsx:85-105`.

- Read `lib/i18n/context.tsx`, `lib/i18n/messages/schema.ts` and how `pages/admin/CouponsPage.tsx` uses
  `const { t } = useI18n()` with `t("Admin.Coupons.title")`. Follow that exactly.
- Add one object `Counter` inside the existing `Admin` object of `lib/i18n/messages/az.ts`, and the same
  keys in `ru.ts` and `en.ts`. Confirm first with a search that `Admin.Counter` does not exist; if it
  does, stop on this item and say so. The Azerbaijani value of each key is the literal that is in the
  code today, unchanged. Write natural Russian and English for the other two.
- Texts with a value in them use a `{name}` placeholder and `.replace`, the way
  `pages/storefront/CheckoutPage.tsx` does with `Checkout.courierWillCall`. Examples: the sale-number
  outcomes in `CounterPage.tsx:94-95`, "Sistemdə {n} ədəd var…" in `CartLines.tsx`, the insufficient-tender
  line in the modal.
- `ReceiptModal.tsx`: take `locale` from `useI18n()`; use it instead of the hard-coded `"az-AZ"` (`:101`)
  and instead of the hard-coded `"az"` in `lineTitle` (`:20`, keep the fall back to the first translation)
  and in the shop-name lookup (`:48`, keep the fall back to the first value). The `PAYMENT` map (`:17`)
  becomes `t()` calls.
- Currency code `AZN`, `#`, `×`, `№` and numbers stay literals.
- `__tests__/i18n-consistency.test.ts` and `__tests__/admin-i18n.property.test.ts` must still pass; read
  them before adding keys so the new keys satisfy whatever they check.

## 6. Small defects in the same files

- `CounterPage.tsx:128` — `LookupBox` refocuses itself on blur (`LookupBox.tsx:74`) and fights the modal
  for focus. Pass `disabled={pending || !!picker || showConfirm || !!completedReceipt}`.
- `ReceiptModal.tsx:38-54` — a failed fetch leaves the previous sale on screen, or "loading" forever.
  At the start of the effect call `setSale(null)` and reset an `error` boolean state; when the sale
  request is not ok or the promise rejects, set `error` and stop loading. Render a short translated
  error text with the close button instead of the loading text. Never render a sale whose `id` differs
  from `saleId`.
- `ReceiptModal.tsx:61-68` — add a `DialogDescription` (import it from `@/components/ui/dialog`, as
  `PaymentConfirmationModal.tsx` does) with a translated one-line description; class `sr-only`.
- `PaymentConfirmationModal.tsx:67-69` — the `<label>` labels nothing. Make it a `<span id="payment-method-label">`
  and put `aria-labelledby="payment-method-label"` on the `role="radiogroup"` div instead of `aria-label`.

## 7. File size and duplication

- `PaymentConfirmationModal.tsx` is 218 lines; the house limit is 200. The three payment buttons
  (`:71-115`) are one block three times: render them from an array of `{ method, Icon, labelKey }` with
  `.map`. The file must end under 200 lines after items 2, 5 and 6.
- `CounterCheckoutPanel.tsx:1` imports `Link` and never uses it: remove the import.
- `Outcome` is declared in both `CounterPage.tsx:16` and `CounterCheckoutPanel.tsx:3`. Export it once
  from `components/admin/counter/types.ts` and import it in both.

## What you must not do

- No change to the API, to `lib/counter-pricing`, to any migration, or to any file not named above
  (the three dictionaries and the two new files are named).
- No arrow-key handling for the radio buttons, no stored tender, no upper bound on the tender input:
  those are recorded, not part of this round.
- No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted or weakened test, no new dependency.

## Notes

Write `docs/audits/fix-counter-sale-confirmation-round-1-notes.md`: what changed per item; every test
added; **Blocked / Assumptions / Not verified** (nothing here was run in a browser — say so; the
integration and E2E tiers were not run by you — say so); tests deleted, renamed or weakened ("None" if
none); the real output of `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`.
If a line number, name or key above is wrong against the code, stop on that item and say so in the notes
instead of guessing a different fix.

## Done means

The three local commands pass. Seven commits, `fix(counter): …` / `test(counter): …`, plus one
`docs(audit): …` commit for the notes.
