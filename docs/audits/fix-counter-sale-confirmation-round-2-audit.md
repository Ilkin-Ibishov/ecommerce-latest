# Re-audit — fix/counter-sale-confirmation, round 2

Date: 2026-11-16. Branch tip audited: `1be07df`. Range: `1ec132d..1be07df`.
Read-only sub-agent (Sonnet, clean context, own worktree). Both majors were then re-checked against
the code by the architect and **both are confirmed**.

**Verdict: FIX.** All 8 prompt items are implemented as written; the two majors are defects the round
introduced in paths a cashier reaches, not deviations from the prompt. Round 3 is needed before merge.

## Items 1-8 — all done as specified

`CounterPage.tsx:97-101` (5xx = catch behaviour, `pending` kept, `soldAtRef` kept), `:102-109`
(ST020 mints a fresh id, cart kept; `code` really is returned — `routes/admin/counter-sales.ts:29-31`),
`:46-55` (beforeunload), `:64` and `:160-163` (late-lookup guard), `LookupBox.tsx:76-80` (verbatim from
the prompt), `CartLines.tsx:42` and `:97` (commit on blur/Enter; "+" capped at 9999), `CartLines.tsx:76`
and `CounterPage.tsx:80` (non-tracked `available`), `ReceiptModal.tsx:42,51,53,67,71,81` (cancelled flag,
settings fallback, scroll). `voidSale` and `alreadyRecorded` are in az/ru/en; `CounterSalesPage.tsx:80`
uses `voidSale`; `PaymentConfirmationModal.tsx:184` still uses `cancel`, as the prompt required.
`Admin.Counter.available` is removed and unread (zero hits over `src` and `tests`; `bundleAvailable`
is a different key and is still used at `CounterPage.tsx:170`).

House rules clean: no `@ts-ignore`, no `as any`, no `.skip()`, no deleted or weakened test, no new
dependency, no API / `lib/counter-pricing` / migration file touched. `ReceiptModal.tsx` 199 lines,
`PaymentConfirmationModal.tsx` 199. Eight fix commits plus one notes commit, as required.

## Major 1 — the scanner never gets focus back after a quantity or tender edit

`LookupBox.tsx:76-80`:

```tsx
onBlur={(e) => {
  const next = e.relatedTarget;
  if (disabled || next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement || next instanceof HTMLSelectElement) return;
  setTimeout(() => input.current?.focus(), 0);
}}
```

Focus only ever returns to the lookup box through the lookup box's *own* blur handler. The cashier
clicks the quantity field: the lookup blurs, `relatedTarget` is that input, refocus is correctly
skipped. They type `3` and press Enter — `CartLines.tsx:45-48` runs `commit(); e.currentTarget.blur();`
and focus lands on `body`. Tabbing out of the tender field or clicking empty space ends the same way.
Nothing refocuses the lookup: its effect (`LookupBox.tsx:21-23`) only reruns when `disabled` or `busy`
change. **The next wedge scan types into nothing** until the cashier clicks the box by hand. Before
round 2 the unconditional refocus hid this; the file's own header comment still claims it "keeps focus
after every action". **Confirmed against the code by the architect.**

Side effect in the same place: `busy` going true → false at `:22` calls `focus()` unconditionally, so a
lookup that finishes while the cashier is mid-typing in a quantity field steals focus away.

## Major 2 — a deterministic 5xx now freezes the till with no way out

`CounterPage.tsx:97-101` keeps `pending` true on any `res.status >= 500`. The API maps **every**
unmapped database error to 500 — `routes/admin/counter-sales.ts:30`:
`res.status(HTTP[error.code ?? ""] ?? 500).json({ error: error.message, code: error.code });`

So a repeatable server-side failure gives "Connection error. Outcome unknown: resend." forever: the
cart, tender and payment stay disabled, Resend replays the same failing request, and the new
`beforeunload` (`:46-55`) warns on reload. The only escape is a reload, which loses the cart. The real
server message in `data.error` is discarded. The round-2 prompt asked for exactly this behaviour, so
the builder is not at fault — the design needs an escape. **Confirmed against the code by the architect.**

## Minors — recorded

3. `CounterPage.tsx:160-163`: a late lookup result is dropped silently while `pending || showConfirm`.
   `LookupBox.tsx:44` has already cleared the text, so the cashier believes the item was scanned.
   Same line uses a ternary as a statement; whether eslint `no-unused-expressions` is on was not checked.
4. `CounterPage.tsx:95` `await res.json().catch(() => ({}))` still yields `null` when the body is the
   JSON literal `null`; `data.code` at `:102` then throws and falls through to the catch. On a **200**
   with an unparseable body `data` is `{}`, giving "Satış #undefined tamamlandı",
   `setCompletedReceipt({ id: undefined })` and a cleared cart. Edge cases.
5. In-SPA navigation while `pending` (the "Satışlar" `Link` at `CounterPage.tsx:155`) is not covered by
   `beforeunload`. State and sale id are lost silently and the next ring creates a second sale.
6. `CartLines.tsx:23-33`: an invalid typed quantity (0, 10000, 2.5, empty) is silently reverted on blur
   with no message. The scanner path (`addItem`, `:69`) has no 9999 cap. Judged effectively unreachable
   because pressing "Tamamla" blurs and commits first.
7. The `voidPrompt:` line is rewritten in all three dictionaries with no visible change — a
   whitespace-only edit (`git diff -w` shows 2 insertions / 1 deletion). Not mentioned in the notes.

## E2E spec — checked selector by selector, clean

Every selector and accessible name exists: "Tamamla" = `complete` (`az.ts:1147`), "Təsdiqlə və Satışı
Tamamla" = `confirmAndComplete` (`az.ts:1160`), "Yeni Satış" = `newSale` (`az.ts:1176`, rendered at
`ReceiptModal.tsx:157`), `#tendered-amount-modal` = `PaymentConfirmationModal.tsx:108` (cash is the
default and "Nağd" is pre-selected), `#inpage-receipt` = `ReceiptModal.tsx:128`, the spinbutton is the
`QuantityCell` `type="number"` input.

- `getByRole("status")` is a **single** match at that point: the other two (`LookupBox` notFound,
  `PickupPanel` message) are conditional and not rendered in this flow, and the receipt dialog is gone
  by then.
- The status message **survives** "Yeni Satış": `onClose` only does `setCompletedReceipt(null)`
  (`CounterPage.tsx:219`); `outcome` is untouched. The regex is unanchored, so the trailing "Qəbzə bax"
  button text does not break it.
- `getByRole("button", { name: "Tamamla" })` is a substring match, but "Təsdiqlə və Satışı Tamamla" is
  not in the DOM until the modal opens, so there is no strict-mode ambiguity.
- **The "wedge scanner at desktop width" flake seen on CI run 43846603768 is not explained by this
  diff.** The scan/focus steps (`:57-68`) are untouched, and the new blur guard only skips refocus when
  focus moves into another input, which nothing in that part of the flow does. Most likely pre-existing
  timing: the second scan is typed the moment the first cart line appears, racing the `busy` to false
  refocus. Unresolved; see Major 1, which touches the same mechanism.

## Notes file vs diff

All 8 items are described accurately, hashes included, and the "Not verified" section honestly says
nothing was run in a browser. Gaps: the `voidPrompt` whitespace churn (minor 7) is not mentioned, and
**"Assumptions: None" is wrong** — the notes should have said that the item-4 guard leaves focus
unrestored after a quantity or tender edit, and that a 5xx now freezes the till until reload.

## Not verified

Nothing was run: no browser, no typecheck, no test tier, in this audit. The builder's own run reported
typecheck clean, 749 unit tests and 20/20 invariants; CI for this branch has not been dispatched.
