# Product Comparison Tool

## What & Why
Major Azerbaijani electronics competitors (Kontakt, Texnomart) all have product comparison. Shoppers buying phones, TVs, or appliances want to compare 2–3 models side-by-side before committing. Without it, they leave the site to compare elsewhere and often don't return. This is a P3 competitor gap feature.

## Done looks like
- A "Compare" button appears on every ProductCard and ProductDetail page (icon + tooltip)
- Clicking Compare adds the product to a comparison tray (floating bar at the bottom of the screen, max 3 items)
- Comparison tray shows product thumbnails; clicking "Müqayisə et" opens a full comparison page
- Comparison page shows a table: product images + prices in the header, then each spec key as a row with values side-by-side; cells that differ are highlighted
- Differences are visually highlighted (e.g. yellow background on the winning/different value)
- Compare state is stored in localStorage and persists across navigation
- Works entirely on the frontend — no new API needed (specs already available via `/products/:id/specs`)

## Out of scope
- Saving/sharing comparison links (future)
- More than 3 products at once
- Comparing across categories with mismatched specs

## Steps
1. **Compare context** — Create a React context (`CompareContext`) that holds up to 3 product IDs in localStorage; expose `addToCompare`, `removeFromCompare`, `clearCompare`, `isComparing` helpers
2. **Compare button on cards** — Add a small compare toggle button to `ProductCard` and `ProductDetail` that adds/removes the product from the comparison context; button turns active (yellow) when the product is already selected
3. **Floating comparison tray** — Build a sticky bottom bar (shown when 1+ products selected) displaying product thumbnails, a clear button, and a "Müqayisə et (N)" call-to-action; rendered in `App.tsx` outside the page layout so it's always visible
4. **Comparison page** — Create `/az/compare` (and `/ru/compare`) route and page that fetches full product data + specs for all selected IDs; renders a responsive table with products as columns and spec keys as rows; highlights differing cells
5. **Wire into routing** — Register the CompareContext in `App.tsx`, add the comparison route, and ensure the floating tray doesn't overlap the mobile bottom nav

## Relevant files
- `artifacts/store/src/App.tsx`
- `artifacts/store/src/components/storefront/ProductCard.tsx`
- `artifacts/store/src/components/storefront/ProductDetail.tsx`
- `artifacts/api-server/src/routes/products.ts`
