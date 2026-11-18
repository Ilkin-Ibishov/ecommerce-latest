# Re-audit — fix/storefront-mobile-spa, round 2

Date: 2026-11-16. Branch tip audited: `14ad31e`. Range: `7a38a00..14ad31e`.
Read-only sub-agent (Sonnet, clean context, own worktree), then spot-checked by the architect.

**Verdict: PASS.** No majors. Three minors, none a merge blocker.

## Item-by-item

| Prompt item | Result |
|---|---|
| 1. Cart drawer auto-close effect removed | Done. `CartDrawer.tsx` now equals `main`'s version plus the import change; the drawer still closes via the checkout `Link onClick={onClose}` (`:272`), product links (`:145`, `:154`), backdrop (`:93`), X (`:107`), continue-shopping (`:139`), Escape (`:42`), and `Header.tsx:76-80` on route change. Both paths are idempotent. Opening the drawer on `/…/checkout` now stays open — the intended fix |
| 2. Out-of-order suggestions | Done. `HeaderSearchBar.tsx:24` `requestRef`; `:32` `const requestId = ++requestRef.current;`; `.then`/`.catch`/`.finally` all guarded; `closeSuggestions` (`:86-92`) clears the debounce, bumps the ref, clears loading. No fast result is dropped |
| 3. Scroll lock | Done. `index.css:538-541` is `body { max-width: 100%; overflow-x: clip; }`; the `html` rule is gone and nothing sets overflow on `html`. The three lock setters (`CartDrawer.tsx:48-49`, `ProductGallery.tsx:104-106`, `admin/ConfirmDialog.tsx:35-38`) all write inline `body.style.overflow` and all release in cleanup. No path to a permanently unscrollable page was found |
| 4. Order-success total | Done. `CheckoutPage.tsx:41` state, `:198` `setPlacedTotal(total)` immediately before `setPlaced(true)` (`:199`) and `clearCart()` (`:200`); success screen reads it at `:216`. `clearCart` is called from exactly one place in the store, so every path is covered |

## Minors — recorded, not fixed

1. **`HeaderSearchBar.tsx:27-31` — stale dropdown under a too-short query.** The `q.length < 2`
   early return does not bump `requestRef`. Type "ab", backspace to "a" before the answer lands:
   the in-flight "ab" response still passes the guard and calls `setShowSuggestions(true)`, so a
   dropdown of "ab" results appears under a one-character query. `Escape` (`:79-81`) has the same
   gap — it only calls `setShowSuggestions(false)` without invalidating. **Verified against the code
   by the architect.** Fix is two lines: bump the ref in the short-query branch, and call
   `closeSuggestions()` on Escape. The round-2 prompt did not ask for this, so it is a gap in the
   prompt, not a deviation by the builder.
2. **`HeaderSearchBar.tsx:86-92` with `SearchSuggestions.tsx:47,55` — cosmetic.** An outside
   `mousedown` now also kills the pending debounce and request. Clicking away while a request is
   pending and refocusing shows the stale earlier suggestions until the shopper types again.
3. **`CheckoutPage.tsx:198` — limitation, not a defect.** `placedTotal` snapshots the
   client-computed `total` (`:137`), not a server figure. If prices changed between render and
   commit, the success message can differ from what the server charged. The prompt forbade API
   changes. Whether `POST /orders` returns a total was not checked.

Commit-message wording only: `c4bad55` says "cancel pending requests"; nothing is aborted, late
answers are ignored. No `AbortController` exists, so nothing leaks.

## Checks that came back clean

- i18n: no new or changed user-facing string; no JSX literal added.
- Notes (`docs/audits/fix-storefront-mobile-spa-round-1-notes.md`, round-2 section) match the four
  code commits and their hashes, and carry the required Blocked / Assumptions / Not verified section.
- House rules: no `@ts-ignore`, no `as any`, no `.skip()`, no deleted or weakened test, no new
  dependency, no new code file over 200 lines, no out-of-scope file touched.

## Not verified

Nothing was run in a browser. The scroll-lock conclusion is computed from the CSS overflow
propagation rule (`html` visible → `body`'s overflow propagates to the viewport), not observed.
The sub-agent ran no tests and no typecheck; CI for this branch is a separate record.

## CI

Run **43849025764** on `14ad31e`, dispatched by hand: **green**. `unit` success; `integration-e2e`
success — 54 component, 110 integration files / 1179 tests passed with 10 skipped, 1 serial settings
test, 42 E2E passed with 1 skipped (4.2m). The `counter-sale.spec.ts` "wedge scanner at desktop
width" case that was flaky on run 43846603768 passed here.

This branch is rebased on `main`, round-2 audited PASS and CI green. **It needs only the owner decision
to merge.**

Still visible in that run and unrelated to this branch: `tests/orders.test.ts` reports `5 tests | 5
skipped` — the undeclared `verify` defect recorded in the morning handoff is still live on `main`.
