# fix/counter-sale-confirmation — fix round 2

Read `AGENTS.md`, `.agents/rules/frontend.md` and `.agents/rules/testing.md`. Branch
`fix/counter-sale-confirmation`; it is checked out. Never commit to `main`. Do not push. Do not touch
any Supabase project, do not run SQL, do not add or edit a migration, do not change anything under
`artifacts/api-server/`.

A re-audit (`docs/audits/fix-counter-sale-confirmation-round-1-audit.md` on branch
`audit/counter-sale-confirmation-round-1`; everything you need is below) returned FIX. Eight changes,
one commit each, in this order. Nothing else: do not restyle, do not refactor nearby code.

Paths are under `artifacts/store/src/` unless written in full. Line numbers are for the tip `8b0fdea`.

## 1. A 5xx after the sale was committed still ends in a 409 loop

`pages/admin/CounterPage.tsx:84-90`: every non-ok response unfreezes the till and resets `soldAtRef`.
But a 5xx can arrive after the database committed the sale (the API lost the database's answer). The
next confirm then sends a new `sold_at` with the same id and gets `ST020` (409) forever.

- In the `!res.ok` branch, when `res.status >= 500`: behave exactly like the `catch` branch (`:108-111`)
  — close the modal, set the network-error outcome, keep `pending` true, do not reset `soldAtRef`.
  The existing "resend" button then replays the same request.
- When `data.code === "ST020"` (the API returns `{ error, code }`,
  `artifacts/api-server/src/routes/admin/counter-sales.ts:29-31`): show a new translated text
  `Admin.Counter.alreadyRecorded` (az: "Bu satış artıq qeyd olunub. Satışlar siyahısını yoxlayın."),
  and start a fresh attempt: `setSaleId(crypto.randomUUID())`, `soldAtRef.current = null`,
  `setPending(false)`, `setShowConfirm(false)`. Keep the cart.
- Any other 4xx: as now.

## 2. Leaving the page with an unknown outcome

`CounterPage.tsx`: after a lost response a reload gives an empty till with a new id, and re-ringing
creates a second sale. Add one effect: while `pending` is true, register a `beforeunload` listener that
calls `e.preventDefault()`; remove it in the cleanup. Nothing else.

## 3. A late lookup answer changes a frozen cart

`CounterPage.tsx:52-54` and `:132`: a lookup still in flight can resolve after the cart was frozen;
`addItem` then adds a line and clears `outcome`, which disables the resend button. At the top of
`addItem`, and in the `onResults` callback before `setPicker(items)`, return early when
`pending || showConfirm`.

## 4. The lookup box steals focus from the quantity and tender fields

`components/admin/counter/LookupBox.tsx:76`: `onBlur` refocuses the lookup input after 0 ms whatever
was clicked, so typing a quantity in `CartLines` or a tender in `CounterCheckoutPanel` lands in the
lookup box. Take the event and skip the refocus when the element receiving focus is a form field:

```tsx
onBlur={(e) => {
  const next = e.relatedTarget;
  if (disabled || next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement || next instanceof HTMLSelectElement) return;
  setTimeout(() => input.current?.focus(), 0);
}}
```

Change nothing else in the file.

## 5. Quantity field: a prefix is committed while typing; "+" has no upper bound

`components/admin/counter/CartLines.tsx:42-48`: the `onChange` handler calls the parent on every
keystroke, so typing "2.5" commits 2 after the first key. The handler only does `setVal(e.target.value)`;
the parent is called from `commit()` alone (blur and Enter, `:23-33`, unchanged).
`:103-104`: the "+" button is also disabled when `line.quantity >= 9999`.

## 6. False "owner must check stock" warning on non-tracked items

A non-tracked variant has `on_hand` 0 and `available === null`
(`components/admin/counter/types.ts:12,33`); the server writes no movement for it and the sale posts
normally.

- `CartLines.tsx:82`: `const overOnHand = line.available !== null && total > line.on_hand;`
- `CounterPage.tsx` `addBundle` (the `available: l.on_hand` at about `:68`): use
  `available: l.track_stock === false ? null : l.on_hand`. `track_stock` is already on the bundle line
  type (`types.ts:22`).

## 7. Receipt modal: out-of-order answers, settings failure, long receipts

`components/admin/counter/ReceiptModal.tsx`:

- `:40-68`: add `let cancelled = false;` at the start of the effect, return `() => { cancelled = true; }`,
  and do nothing in `.then` / `.catch` when `cancelled`.
- `:50`: a failed `/site-settings` request must not turn a loaded sale into the error state: add
  `.catch(() => null)` to that one promise.
- `:77`: `<DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">`.

## 8. Translations and the E2E spec

- `pages/admin/CounterSalesPage.tsx:80` uses `Admin.Counter.cancel` ("dismiss") for the void action.
  Add `Admin.Counter.voidSale` to `lib/i18n/messages/az.ts`, `ru.ts`, `en.ts` (az: "Ləğv et", ru:
  "Аннулировать", en: "Void") and use it there. `PaymentConfirmationModal.tsx:184` keeps `cancel`.
- Remove the unused key `Admin.Counter.available` from the three dictionaries (confirm with a search
  that nothing reads it; `bundleAvailable` is a different key and stays).
- Add `Admin.Counter.alreadyRecorded` (item 1) to the three dictionaries.
- `artifacts/store/tests/e2e/counter-sale.spec.ts` no longer matches the UI. Update the flow, keep
  every database assertion (`:87-101`) exactly as it is:
  - `:71` — the quantity is an input now: `await expect(cartLines.first().getByRole("spinbutton")).toHaveValue("2");`
  - `:82-85` — "Tamamla" opens the confirmation dialog. After clicking it: fill the tender
    (`await page.locator("#tendered-amount-modal").fill("10");`), click the button named
    "Təsdiqlə və Satışı Tamamla". The receipt dialog then opens by itself and hides the rest of the
    page from the accessibility tree, so assert the receipt first:
    `await expect(page.locator("#inpage-receipt")).toBeVisible({ timeout: 10000 });` and
    `toContainText("8.00")`, then click the button named "Yeni Satış", and only then assert the status
    text (`:85`, unchanged regex).
  - `:103-106` — delete the old "Qəbz" link steps; the receipt was asserted above. This replaces an
    assertion with an equivalent one; name it in the notes under "tests changed".
  - You cannot run this tier. Read `PaymentConfirmationModal.tsx`, `ReceiptModal.tsx` and
    `CounterCheckoutPanel.tsx` to confirm each selector and label before writing it.

## What you must not do

- No change to the API, to `lib/counter-pricing`, to any migration, or to any file not named above.
- No print-CSS change, no stored tender, no arrow-key handling: recorded, not part of this round.
- No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted test, no new dependency.

## Notes

Append a "Round 2" section to `docs/audits/fix-counter-sale-confirmation-round-1-notes.md`: what
changed per item; tests added, changed, deleted or weakened, by name; **Blocked / Assumptions / Not
verified** (nothing was run in a browser — say so, items 4 and 7 in particular; the E2E and integration
tiers were not run by you — say so); the real output of `pnpm run typecheck`, `pnpm test:unit` and
`pnpm run audit:invariants`. If a line number, name or key above is wrong against the code, stop on
that item and say so in the notes instead of guessing a different fix.

## Done means

The three local commands pass. Eight commits (`fix(counter): …`, `test(counter): …`), plus one
`docs(audit): …` commit.
