# Chore — fix the 8 real failures from CI round 10's first-ever E2E run

Round 10 of the `integration-e2e` job (run 42396485221, branch `claude/davam-840a9f`) got
`unit` and `api-integration` fully green for the first time ever. `integration-e2e`'s Playwright
suite then ran for the first time against a real, non-empty backend (previous rounds never got
this far) and failed 8 tests across 4 spec files. Every root cause below has already been
diagnosed by reading the actual component/route source — do not re-diagnose from scratch,
implement the fix described. If you find a diagnosis below is wrong once you read the code, stop
and say so in the notes file rather than guessing a different fix.

Four prescriptive items. Nothing else. Do not refactor anything nearby you were not told to
touch. Branch from `chore/e2e-round10-fixes` (already created, based on `claude/davam-840a9f`).
One commit per item.

---

## 1. `admin-panel.spec.ts` — two stale/ambiguous locators

**1a.** `artifacts/store/tests/e2e/admin-panel.spec.ts:54`, test `"shows KPI cards with revenue
and order data"`:

```ts
await expect(page.getByText("Revenue")).toBeVisible();
```

The dashboard KPI card renders both a heading `"Revenue — This month"` and a caption `"By
revenue, from orders placed in selected period"` — both contain the substring "Revenue", so
`getByText("Revenue")` is a strict-mode violation (resolves to 2 elements) and the assertion
fails outright with that error, not a timeout.

Fix: add `.first()`, exactly like the very next line in the same test already does for `"AZN"`:

```ts
await expect(page.getByText("Revenue").first()).toBeVisible();
```

**1b.** `artifacts/store/tests/e2e/admin-panel.spec.ts:132`, test `"sortable columns work"`
(inside `test.describe("Inventory Page", ...)`):

```ts
await page.locator("th").filter({ hasText: "Stock" }).click();
await expect(page.locator("th").filter({ hasText: "Stock" }).locator("svg")).toBeVisible();
```

`artifacts/store/src/pages/admin/InventoryPage.tsx` (around line 340) renders this column's
header as `label="On Hand (H)"` (via `<SortableHeader label="On Hand (H)" sortKey="stock" ...>`)
— M1 renamed stock terminology from "Stock" to "On Hand" at the variant level. No `<th>` contains
the literal text "Stock" anymore, so the locator never resolves and `.click()` times out at the
suite's 60s test timeout (this is why it failed with a *timeout*, not an immediate error, unlike
1a).

Fix: change both occurrences of `{ hasText: "Stock" }` in this test to `{ hasText: "On Hand" }`.

## 2. `checkout-flow.spec.ts` — all 4 tests fail from one root cause: a fabricated, invalid product id

`artifacts/store/tests/e2e/checkout-flow.spec.ts`'s `test.describe("Checkout Flow", ...)` has a
shared `beforeEach` (around line 14) that seeds the cart via `localStorage` with a fabricated,
non-UUID `product_id: "test-product-id"`.

`artifacts/store/src/pages/storefront/CheckoutPage.tsx` (around line 39-70) runs an effect on
mount that POSTs every cart item's `product_id` to `/api/products/prices` to detect stale prices.
`artifacts/api-server/src/routes/products.ts:20-23` runs
`admin.from("products").select(...).in("id", product_ids)` with no error handling — `products.id`
is a `uuid` column, so filtering `.in("id", ["test-product-id"])` fails the whole Postgres query
(invalid UUID literal), `data` comes back `null`, and the route happily returns `{}` as the price
map (the destructured `error` from the query is never checked). Back in `CheckoutPage.tsx`, the
cart item's `product_id` isn't a key in that empty map, so the "product no longer exists" branch
fires and `removeItem(item.product_id)` empties the cart. Once `items.length === 0`,
`CheckoutPage.tsx` (around line 196) renders a completely different "empty cart" view with **no
`<h1>` and no form at all** — explaining every one of the 4 failures (missing `h1`, missing
validation-error elements after the form unmounts mid-test, and `.fill()` timing out on inputs
that got removed from the DOM while Playwright was retrying actionability).

This was never caught before because this is the first time these E2E tests have run against a
real backend that actually validates cart contents — previously there was nothing behind
`/api/products/prices` to reject the fake id.

Do **not** patch `/api/products/prices` to tolerate invalid UUIDs — that's a real latent
robustness gap (worth its own follow-up) but out of scope here, and tightening it wouldn't fix
these tests anyway: even a well-formed-but-nonexistent UUID would still get the item removed by
design (that's what the "product no longer exists" branch is *for*).

Fix: replace the fabricated cart item with a real one, added through the app's own add-to-cart
flow, so the price-check finds a real row and leaves the cart alone. Change the shared
`beforeEach` from directly writing to `localStorage` to this:

```ts
test.beforeEach(async ({ page }) => {
  // Add a real product to the cart via the storefront's own add-to-cart button, so the
  // checkout page's server-side price/stock check (POST /api/products/prices) finds a real
  // row instead of emptying the cart.
  await page.goto("/az/products");
  await page.waitForLoadState("networkidle");
  const addToCartBtn = page.getByRole("button", { name: "Səbətə əlavə et" }).first();
  await expect(addToCartBtn).toBeVisible({ timeout: 15_000 });
  await addToCartBtn.click();
});
```

`"Səbətə əlavə et"` is the Azerbaijani (`az` locale) translation of `ProductCard.addToCart`
(`artifacts/store/src/lib/i18n/messages/az.ts`), matching the aria-label on
`artifacts/store/src/components/storefront/ProductCard.tsx`'s add-to-cart button (around line
125-130). Since every test in this file navigates to `/az/...` paths, this stays consistent with
the rest of the suite.

After this change, the 4 individual tests should need no further changes — they read `"Test
Product"` and a hardcoded price of `50` nowhere outside the old fixture, so check each test body
for any assertion that depended on the old fabricated title/price (e.g. `text=Test Product`,
`text=AZN`) and, only where a test asserts the *exact fabricated* title/price, relax it to assert
general presence of a product name/price instead (don't invent a specific product's real title —
you don't know it in advance; assert structurally, e.g. that some non-empty product name and an
`AZN` amount are visible).

## 3. `search-and-navigation.spec.ts:69` — ambiguous back-to-products link

```ts
const backLink = page.locator("a[href*='/products']");
await expect(backLink).toBeVisible();
```

The 404 page's header/footer/nav already has several links containing `/products` in their
`href` (nav link, bottom nav, sale/deal filtered links, and the page's own "back to products"
link) — 6 total, a strict-mode violation. The test's own intent (comment: "Should have a link
back to products") doesn't care which specific one matches, just that at least one exists.

Fix: add `.first()`:

```ts
const backLink = page.locator("a[href*='/products']").first();
```

## 4. `storefront-browsing.spec.ts:36` — grid selector matches an icon, not the grid

```ts
const productGrid = page.locator('[class*="grid"]').first();
await expect(productGrid).toBeVisible({ timeout: 15_000 });
```

`artifacts/store/src/components/storefront/ProductGrid.tsx` (around line 34-38) renders the
actual grid as a `<div className="grid grid-cols-2 ...">`. But the page also has a view-toggle
icon earlier in the DOM using a lucide icon class that happens to contain "grid"
(`lucide-grid3x3`, confirmed from the CI failure's own error output: `locator resolved to <svg
... class="lucide lucide-grid3x3 lucide-grid-3x3">`), and `[class*="grid"]` matches that `<svg>`
first — which is a hidden icon, not the product grid, hence `Received: hidden`.

Fix: scope the selector to a `div` so it can't match an `<svg>`:

```ts
const productGrid = page.locator('div[class*="grid"]').first();
```

---

## Definition of done

- `pnpm run typecheck` and `pnpm run audit:invariants:strict` green
- `pnpm run test:unit` green
- Four commits, one per item above (item 1's two sub-fixes can be one commit since they're both
  one-line locator changes in the same file)
- `docs/audits/chore-e2e-round10-fixes-notes.md` written: each item, what you changed, and the
  real output of the commands you ran

You cannot run the `integration-e2e` project locally — it needs a running API server, a running
store dev server, and live Supabase credentials. Do not claim it passes. Say plainly which tiers
you actually ran.

Do not run migrations against any remote Supabase project. Do not acquire or touch Supabase
credentials. Do not push. Do not touch `main`.
