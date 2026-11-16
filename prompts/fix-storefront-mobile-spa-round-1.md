# fix/storefront-mobile-spa — fix round 1

Read `AGENTS.md` and `.agents/rules/frontend.md` (run `modern-web-guidance` `search` before item 4).
You are in a worktree whose checked-out branch is `round/storefront-fix`; it is
`fix/storefront-mobile-spa` rebased on `main` (M4 is merged). Commit on the checked-out branch. Do not
push, do not switch branches, never commit to `main`. Do not touch any Supabase project, do not run SQL,
do not change anything under `artifacts/api-server/` or `supabase/`.

An audit did not approve this branch (`docs/audits/fix-storefront-mobile-spa-audit.md` on branch
`audit/storefront-mobile-spa`; everything you need is below). Six changes, one commit each, in this
order. Nothing else: do not restyle, do not refactor nearby code.

All paths are under `artifacts/store/src/`. Line numbers are for the tip `80bb6a2`; `main` means
`origin/main`.

## 1. Checkout shows a delivery fee the server never charges (blocker)

`pages/storefront/CheckoutPage.tsx` adds 5 AZN under 100 AZN in the browser only;
`artifacts/api-server/src/routes/orders.ts` stores `subtotal - discount`. The customer is told to pay
5 AZN more than the order records. The fee is a separate phase (`docs/tasks/delivery-fee.md` §8 says
this branch removes its own constants). Remove, in `CheckoutPage.tsx`:

- the constants `FREE_DELIVERY_THRESHOLD` and `STANDARD_DELIVERY_FEE` (`:14-15`);
- `isFreeDelivery` and `deliveryFee` (`:137-138`);
- `+ deliveryFee` in `total`: the line is again `const total = Math.max(0, subtotal - discountAmount);`
- the delivery row in the summary (`:332-337`): put back the single line that `main` has —
  `git show origin/main:artifacts/store/src/pages/storefront/CheckoutPage.tsx`, the line containing
  `t("Checkout.delivery")` — verbatim.

Do not touch `FREE_DELIVERY_THRESHOLD` in `components/storefront/CartDrawer.tsx:9`: it is on `main`
already and belongs to the delivery-fee phase. Keep this branch's other `CartDrawer.tsx` change.
Keep the checkout draft (`CHECKOUT_DRAFT_KEY`, `loadCheckoutDraft`) as it is.

## 2. Invented, industry-specific size-guide content

The branch shows a hard-coded clothing table on every product when no size guide exists, and adds a
`/size-guide` page of clothing and shoe sizes. Both go. House rule: nothing named after one customer's
industry, and no hard-coded user-visible strings.

- `components/storefront/SizeGuideOverlay.tsx`: restore the file from `main`
  (`git checkout origin/main -- artifacts/store/src/components/storefront/SizeGuideOverlay.tsx`).
- `components/storefront/ProductDetail.tsx`: restore only the two size-guide hunks to what `main` has —
  the link is rendered only inside `{sizeGuide && ( … )}` with its comment (`:261-270` now), and the
  overlay is rendered as `{categoryId && sizeGuide && (<SizeGuideOverlay categoryId={categoryId} … />)}`
  (`:441-443` now). Compare with `git diff origin/main -- artifacts/store/src/components/storefront/ProductDetail.tsx`:
  after your change the only remaining difference in that file is the removed breadcrumb block and
  the wrapper `<div className="py-4">`. Keep those two.
- Delete `pages/storefront/SizeGuidePage.tsx`.
- `App.tsx`: remove the lazy import (`:27`), the route `/${locale}/size-guide` (`:189`) and the redirect
  `/size-guide` (`:274`).
- Then search `src/` for `size-guide"` and `SizeGuidePage`: only the two API URLs
  (`/size-guides/${categoryId}`) may remain.

## 3. A junk slug hard-coded in the home page

`pages/storefront/HomePage.tsx:148` hides the product whose slug is `"dsdvsdv"` and any deal priced 0.
Test data is cleaned in the database, not in code. Restore the file from `main`
(`git checkout origin/main -- artifacts/store/src/pages/storefront/HomePage.tsx`); the branch has no
other change in it.

## 4. `overflow-x: hidden` turns the page shell into scroll containers

`overflow-x: hidden` on an element makes its other axis `auto`, so the element becomes a scroll
container: the sticky `<header>` then sticks to a container that does not scroll, and dropdowns under
it can be clipped. `overflow-x: clip` clips without creating a scroll container. After the
`modern-web-guidance` search confirms that:

- `index.css:538-543`: `overflow-x: hidden` → `overflow-x: clip` on `html, body`.
- Replace the class `overflow-x-hidden` with `overflow-x-clip` (Tailwind 4, already installed) in the
  five places this branch added it: `App.tsx:113` and `:115`, `components/storefront/Header.tsx:102`,
  `components/storefront/Footer.tsx:60`, `components/storefront/AnnouncementBar.tsx:11`.
  Find them with `git diff origin/main -- artifacts/store/src | grep overflow-x-hidden`; change exactly those.

## 5. Filter requests can land out of order

`pages/storefront/ProductsPage.tsx:48-128`: filters are client-side navigations now, and the effect has
no guard, so a slow earlier request can overwrite a later one. In that effect add
`let cancelled = false;` before `load`, `return () => { cancelled = true; };` as the effect's cleanup,
and `if (cancelled) return;` after **each** `await` inside `load()` (there are five) before any
`set…` call. Change nothing else in the function.

## 6. Two one-line defects

- `components/storefront/AnnouncementBar.tsx:13`: `truncate sm:whitespace-normal` cuts the message on
  phones. The span's class is `text-center` again. Keep the `px-8` on the parent.
- `components/storefront/LocaleSwitcher.tsx:11-12`: the hash is dropped on a language switch. Append
  `window.location.hash` after the search string. Keep the full-page navigation; do not convert it.

## What you must not do

- No delivery-fee computation anywhere, no new settings read, no API change.
- No new static size table, no new page, no new dictionary keys. Do not delete any key from
  `lib/i18n/messages/*.ts`.
- No `@ts-ignore`, no new `as any` (the existing ones in `ProductsPage.tsx` stay), no `.skip()`, no
  deleted or weakened test, no new dependency.

## Notes

Write `docs/audits/fix-storefront-mobile-spa-round-1-notes.md`: what changed per item; the output of
`git diff --stat origin/main` after your last commit; **Blocked / Assumptions / Not verified** (nothing
was run in a browser or on a phone — say so, and say that item 4 in particular is unverified visually;
the integration and E2E tiers were not run by you); tests deleted, renamed or weakened ("None" if
none); the real output of `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`.
If a line number or name above is wrong against the code, stop on that item and say so in the notes
instead of guessing a different fix.

## Done means

The three local commands pass. Six commits `fix(storefront): …`, plus one `docs(audit): …` commit for
the notes.
