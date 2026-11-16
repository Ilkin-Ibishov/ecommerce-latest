# Audit — fix/counter-sale-confirmation, round 3

Date: 2026-11-16. Audited by the architect against `prompts/fix-counter-sale-confirmation-round-3.md`.
Pre-rebase range `0ee31c0..40453cc`; after rebasing onto `main` (`5f13d71`) the same four fix commits
plus notes are `f291411 f708ba1 7735371 5524e0d df2e8f1`, tip **`df2e8f1`**, pushed as
**`fix/counter-sale-confirmation-r3`**.

**Verdict: PASS.** All four items are implemented exactly as the prompt specified. No scope violations.

## Item by item

| Item | Result |
|---|---|
| 1. Scanner focus return | `LookupBox.tsx:21-24` now guards the `busy` effect on `activeElement` (body / null / the box itself), so a finishing lookup no longer steals focus from a field being typed in. `:26-37` adds the `focusout` listener that returns focus when it has fallen to `document.body`. Both verbatim from the prompt. The `resetSignal` effect is untouched. `CartLines.tsx` and `CounterCheckoutPanel.tsx` were **not** changed for this item, as required |
| 2. 5xx escape | `CounterPage.tsx:31` `failedAttempts`; incremented in the 5xx branch (`:97-98`) and the `catch` (`:143`); reset to 0 on success (`:142`), in the `ST020` branch (`:111`) and in `discardAttempt`. `discardAttempt` (`:159-166`) is verbatim and **keeps the cart**. Wired as `onDiscard` + `canDiscard={pending && outcome?.kind === "error" && failedAttempts >= 3}` (`:220-221`). `CounterCheckoutPanel.tsx:124-133` renders one bordered secondary button under Resend, nothing when `canDiscard` is false. `console.error(data.error)` added; **no raw server message reaches the UI** on the 5xx path |
| 3. `null` / unparseable body | `CounterPage.tsx:96` is now `const data = (await res.json().catch(() => null)) ?? {};`. The 200 guard (`:120-125`) rejects a payload missing `sale_number` or `id` and treats it like the 5xx branch — modal closed, network-error outcome, `pending` kept, `soldAtRef` kept, `failedAttempts` bumped. The cart is no longer emptied on an unparseable 200 |
| 4. In-SPA navigation | `CounterPage.tsx:176-178` renders the "Satışlar" label as a `<span className="text-sm text-muted-foreground">` while `pending`, and the `<Link>` otherwise |

Translations: `startOver` and `discardedCheckSales` added to az, ru and en with the exact strings from
the prompt. `voidPrompt` left alone as instructed.

## Local verification — real output

Run by the architect in `.claude/worktrees/fix-counter-sale` **after** the rebase onto `main`:

- `pnpm run typecheck` — all 5 workspace projects Done, 0 errors.
- `pnpm test:unit` — `68 passed (68)` test files, `749 passed (749)` tests.
- `pnpm run audit:invariants` — "All invariant checks passed."

The builder's own run reported the same three before the rebase. The `api-integration` and E2E tiers
cannot run in a bare local checkout; CI run **43852791362** on `df2e8f1` covers them.

## Noted, not blocking

- `artifacts/store/src/pages/admin/CounterPage.tsx` is now **248 lines**. The prompt's ceiling was
  "about 245". It is an existing file, so the house 200-line rule for *new* files does not bite, but
  this file is the next candidate for extraction and that should be its own change, not a fix round.
- The builder again rewrote one adjacent dictionary line with no visible change — `voidSale` this
  time, `voidPrompt` in round 2. Whitespace-only churn when it inserts neighbouring keys. Harmless;
  worth a line in a future prompt if it keeps happening.
- `console.error(data.error)` logs `undefined` when the 5xx body carries no `error` field. Cosmetic.
- The pre-existing 4xx branch (`:119`) still surfaces `data.error` in the UI. Out of this round's
  scope; the prompt only closed the 5xx path. Worth deciding deliberately later.

## Still open on this branch

- The three round-2 minors the round-3 prompt deliberately left out: silent drop of a late lookup
  result while pending (the cashier gets no signal the scan was ignored), silent revert of an invalid
  typed quantity, and the missing 9999 cap on the scanner `addItem` path. Recorded in
  `docs/audits/fix-counter-sale-confirmation-round-2-audit.md`, minors 3 and 6.
- The "wedge scanner at desktop width" E2E flake first seen on run 43846603768. Round 3 changes the
  focus mechanism that case exercises, so run 43852791362 is the first real evidence either way.

## Not verified

Nothing was run in a browser. Item 1's `focusout` behaviour and item 2's discard button are
unobserved — in particular whether the global `focusout` listener interacts badly with Radix dialogs
is reasoned about (the box is `disabled` while any modal is open, so the listener is detached) but not
tested on a real till.
