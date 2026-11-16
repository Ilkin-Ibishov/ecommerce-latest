# fix/storefront-mobile-spa — fix round 2

Read `AGENTS.md` and `.agents/rules/frontend.md`. You are in a worktree whose checked-out branch is
`round/storefront-fix` (= `fix/storefront-mobile-spa`, rebased on `main`). Commit on the checked-out
branch. Do not push, do not switch branches, never commit to `main`. Do not touch any Supabase
project, do not run SQL, do not change anything under `artifacts/api-server/` or `supabase/`.

A re-audit (`docs/audits/fix-storefront-mobile-spa-round-1-audit.md` on branch
`audit/storefront-mobile-spa-round-1`; everything you need is below) returned FIX. Four changes, one
commit each, in this order. Nothing else: do not restyle, do not refactor nearby code.

All paths are under `artifacts/store/src/`. Line numbers are for the tip `d231663`.

## 1. The cart button does nothing on the checkout page

`components/storefront/CartDrawer.tsx:55-59` — the effect
`if (open && location.includes("/checkout")) onClose();` closes the drawer the moment it is opened on
`/…/checkout`, so the customer cannot change a quantity there. It is also redundant: the checkout
link already calls `onClose` (`:281`) and `Header.tsx:76-80` closes the drawer on every route change.

Delete that effect and its comment (`:54-59`), the `const [location] = useLocation();` line (`:47`), and
`useLocation` from the wouter import (`:2`) — the import is again `import { Link } from "wouter";`.
After this, `git diff origin/main -- artifacts/store/src/components/storefront/CartDrawer.tsx` is empty.

## 2. The suggestion dropdown reopens over the search results

`components/storefront/HeaderSearchBar.tsx`: navigation is now client-side, so a pending debounce timer
(`:49`) or an in-flight suggest request (`:31-42`) still resolves after the user pressed Enter and calls
`setShowSuggestions(true)` (`:36`) on top of the results page.

- Add `const requestRef = useRef(0);`.
- In `fetchSuggestions`, after the `q.length < 2` early return: `const requestId = ++requestRef.current;`
  and in the `.then((data) => …)`, the `.catch` and the `.finally` do nothing when
  `requestId !== requestRef.current`.
- In `closeSuggestions` (the function ending at `:82`), before the existing lines: clear the timer
  (`if (debounceRef.current) clearTimeout(debounceRef.current);`), `requestRef.current++;` and
  `setLoading(false);`.
- Change nothing else in the file.

## 3. Scroll lock leaks behind the cart drawer

`index.css:538-542` puts `overflow-x: clip` on `html` and `body`. With a non-`visible` overflow on
`html`, `body`'s inline `overflow: hidden` (set by `components/storefront/CartDrawer.tsx:50`,
`components/storefront/ProductGallery.tsx:104`, `components/admin/ConfirmDialog.tsx:35`) is no longer
propagated to the viewport, so the page can scroll behind those overlays. Change the selector from
`html,\nbody` to `body` only. Keep both declarations.

## 4. "You will pay 0.00 AZN" after an order

`pages/storefront/CheckoutPage.tsx`: `clearCart()` (`:198`) runs before the success screen renders, so
`total` is 0 there and the `Checkout.courierWillCall` message (`:214`) tells the customer 0.00. This is
on `main` too; fix it here.

- Add state `const [placedTotal, setPlacedTotal] = useState(0);`.
- In the submit handler, call `setPlacedTotal(total);` on the line before `setPlaced(true);`.
- On the success screen use `placedTotal.toFixed(2)` instead of `total.toFixed(2)` for `{amount}`.
- Do not change how `total` is computed, and do not change the API.

## What you must not do

- No change to `ProductsPage.tsx`, to any dictionary file, or to any file not named above.
- No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted or weakened test, no new dependency.

## Notes

Append a "Round 2" section to `docs/audits/fix-storefront-mobile-spa-round-1-notes.md`: what changed
per item; **Blocked / Assumptions / Not verified** (nothing was run in a browser — say so; item 3 is
derived from the CSS propagation rule and is unverified visually; integration and E2E tiers were not
run by you); tests deleted, renamed or weakened ("None" if none); the real output of
`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`. If a line number or name above
is wrong against the code, stop on that item and say so in the notes instead of guessing a different fix.

## Done means

The three local commands pass. Four commits `fix(storefront): …`, plus one `docs(audit): …` commit.
