# fix/counter-sale-confirmation — fix round 3

Read `AGENTS.md`, `.agents/rules/frontend.md` and `.agents/rules/testing.md`. Branch
`fix/counter-sale-confirmation`; it is checked out. Never commit to `main`. Do not push. Do not touch
any Supabase project, do not run SQL, do not add or edit a migration, **do not change anything under
`artifacts/api-server/`**.

A re-audit of round 2 (`docs/audits/fix-counter-sale-confirmation-round-2-audit.md`, on the
orchestrator's branch; everything you need is below) returned FIX with two majors. Both were
confirmed against the code by the architect. Round 2 itself did what its prompt asked — these are
defects the design of that prompt left behind, and two reachable minors from the same report.

Four changes, one commit each, in this order. Nothing else: do not restyle, do not refactor nearby
code, do not touch the E2E spec.

Paths are under `artifacts/store/src/` unless written in full. Line numbers are for the tip `1be07df`.

---

## 1. The scanner never gets focus back after a quantity or tender edit (major)

`LookupBox.tsx:76-80` — round 2's `relatedTarget` guard is correct and stays. The problem is that
focus only ever returns to the lookup box through the lookup box's *own* blur handler. Once the
cashier clicks the quantity field, types `3` and presses Enter, `CartLines.tsx:45-48` runs
`commit(); e.currentTarget.blur();` and focus lands on `document.body`. Tabbing out of the tender
field, or clicking empty space, ends the same way. Nothing brings focus back: the effect at
`LookupBox.tsx:21-23` only reruns when `disabled` or `busy` change. **The next wedge scan types into
nothing.** The file's own header comment still promises the box "keeps focus after every action".

Fix it inside `LookupBox.tsx` only — do not plumb a ref or callback through `CounterPage` and
`CartLines`.

- Add one effect that returns focus when focus has fallen to nothing:

```tsx
useEffect(() => {
  if (disabled) return;
  const returnFocus = () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) input.current?.focus();
    }, 0);
  };
  document.addEventListener("focusout", returnFocus);
  return () => document.removeEventListener("focusout", returnFocus);
}, [disabled]);
```

- Change the existing effect at `:21-23` so a lookup finishing does **not** steal focus from a field
  the cashier is typing in (the audit's side-effect note on `:22`):

```tsx
useEffect(() => {
  if (disabled || busy) return;
  const active = document.activeElement;
  if (!active || active === document.body || active === input.current) input.current?.focus();
}, [disabled, busy]);
```

Leave the `resetSignal` effect at `:25-30` as it is. Do not change `CartLines.tsx` or
`CounterCheckoutPanel.tsx` for this item.

---

## 2. A deterministic 5xx freezes the till with no way out (major)

`CounterPage.tsx:97-101` keeps `pending` true on any `res.status >= 500`. The API maps **every**
unmapped database error to 500 (`routes/admin/counter-sales.ts:30`,
`res.status(HTTP[error.code ?? ""] ?? 500)`), so a repeatable server-side failure gives the cashier
"Connection error. Outcome unknown: resend." forever. The cart, tender and payment stay disabled,
Resend replays the same failing request, and the `beforeunload` effect warns on reload. The only
escape is a reload that loses the cart.

Keeping `pending` true is right — the sale may have committed. What is missing is an escape.

- `CounterPage.tsx`: add `const [failedAttempts, setFailedAttempts] = useState(0);` beside the other
  state (about `:30`).
- In the `res.status >= 500` branch, add `setFailedAttempts((n) => n + 1);`. Everything else in that
  branch is unchanged. Do the same in the `catch` branch at about `:133-136`.
- Reset it to `0` on a successful sale (beside the existing `setPending(false)` on the success path),
  and in the `ST020` branch.
- Add a handler:

```tsx
const discardAttempt = () => {
  setSaleId(crypto.randomUUID());
  soldAtRef.current = null;
  setPending(false);
  setShowConfirm(false);
  setFailedAttempts(0);
  setOutcome({ kind: "error", text: t("Admin.Counter.discardedCheckSales") });
};
```

  It keeps the cart. Pass it to `CounterCheckoutPanel` as a new prop `onDiscard`, together with
  `canDiscard={pending && outcome?.kind === "error" && failedAttempts >= 3}`.
- `CounterCheckoutPanel.tsx`: add the two props to the destructure and the type. When `canDiscard`
  is true, render one secondary button directly under the existing Resend button, calling
  `onDiscard`, labelled `t("Admin.Counter.startOver")`. Style it like the other secondary buttons in
  that file (bordered, not `bg-primary`). Render nothing when `canDiscard` is false.

**Do not surface the server's `data.error` text in the UI.** A raw database message is not for a
cashier and may describe internals. Keep the existing translated `Admin.Counter.networkError`. Add
`console.error` of `data.error` in the 5xx branch so it is visible in the browser console — that is
the whole of what this round does about the discarded message.

Three attempts, not one: a single network blip must not offer to discard a sale that may be
committed. Three is the point at which it is clearly not transient.

---

## 3. A `null` or unparseable JSON body (minor)

`CounterPage.tsx:95` is `const data = await res.json().catch(() => ({}));`.

- Make it `const data = (await res.json().catch(() => null)) ?? {};` so a body that is the JSON
  literal `null` does not make `data.code` at `:102` throw.
- On the success path (`res.ok`), the code currently trusts `data.sale_number` and `data.id`. If
  either is missing or falsy, do **not** clear the cart: treat it exactly like the `res.status >= 500`
  branch (close the modal, network-error outcome, keep `pending`, keep `soldAtRef`, bump
  `failedAttempts`). Today an unparseable 200 shows "Satış #undefined tamamlandı", calls
  `setCompletedReceipt({ id: undefined })` and empties the cart.

---

## 4. In-SPA navigation while the outcome is unknown (minor)

`CounterPage.tsx:155`: the "Satışlar" `<Link>` is not covered by `beforeunload`, so one click while
`pending` loses the cart and the sale id silently, and the next ring creates a second sale.

While `pending` is true, render that link as a non-interactive `<span>` with the same text and
`className="text-sm text-muted-foreground"` instead of a `<Link>`. Nothing else.

---

## What you must not do

- No change to the API, to `lib/counter-pricing`, to any migration, or to any file not named above.
- **No change to `artifacts/store/tests/e2e/counter-sale.spec.ts`.** Round 2 rewrote it; it has not
  been through CI yet. If one of your changes would break a selector in it, stop and say so in the
  notes instead of editing the spec.
- No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted test, no new dependency.
- `CounterPage.tsx` is already 223 lines. Keep your additions tight; do not let it grow past about
  245, and do not "fix" it by extracting components — that is a separate change.

## Translations

Add to `lib/i18n/messages/az.ts`, `ru.ts` and `en.ts`, beside the other `Admin.Counter` keys:

- `startOver` — az: "Ləğv et və yenidən başla", ru: "Отменить и начать заново", en: "Discard and start over"
- `discardedCheckSales` — az: "Satış ləğv edildi. Yenidən vurmadan əvvəl satışlar siyahısını yoxlayın.",
  ru: "Продажа отменена. Перед повторным оформлением проверьте список продаж.",
  en: "Sale discarded. Check the sales list before ringing it again."

While you are in those three files: the `voidPrompt:` line was rewritten in round 2 with no visible
change (a whitespace-only edit). Leave it alone — do not revert it, do not touch it again.

## Verify

Run and paste the real output of all three:

```
pnpm run typecheck
pnpm test:unit
pnpm run audit:invariants
```

You cannot run the E2E or integration tiers. Say so.

## Notes

Append a "Round 3" section to `docs/audits/fix-counter-sale-confirmation-round-1-notes.md`: what
changed per item, with the commit hash; tests added, changed, deleted or weakened, by name ("None" if
none); and **Blocked / Assumptions / Not verified** — in particular, nothing here is run in a browser,
so item 1's `focusout` behaviour and item 2's discard button are unobserved. If you believe one of
these four items is wrong, say so in the notes and implement it anyway; do not silently deviate.
