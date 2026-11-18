# Chore E2E Round 10 Fixes — Implementation Notes

**Date:** 2026-11-07  
**Branch:** `chore/e2e-round10-fixes`

---

## 1. Overview

Round 10 of the `integration-e2e` CI job (run 42396485221, branch `claude/davam-840a9f`) saw `unit` and `api-integration` fully green for the first time. The Playwright E2E suite ran against a real, non-empty backend and reported 8 failures across 4 spec files. All four root causes were pre-diagnosed and confirmed in the codebase. Each prescriptive item has been implemented on its own dedicated commit following repository conventions and AGENTS.md rules.

---

## 2. Changes per Item

### Item 1 — `admin-panel.spec.ts` two stale/ambiguous locators

- **File:** `artifacts/store/tests/e2e/admin-panel.spec.ts`
- **Problems & Changes:**
  - **1a (line 54):** In test `"shows KPI cards with revenue and order data"`, `page.getByText("Revenue")` caused a Playwright strict-mode violation (2 elements: `"Revenue — This month"` heading and `"By revenue, from orders placed in selected period"` caption). Added `.first()`:
    ```ts
    await expect(page.getByText("Revenue").first()).toBeVisible();
    ```
  - **1b (lines 132-133):** In test `"sortable columns work"`, the column header was renamed during M1 variant refactoring from "Stock" to `label="On Hand (H)"` in `artifacts/store/src/pages/admin/InventoryPage.tsx`. No `<th>` element matched `{ hasText: "Stock" }`, causing `.click()` to time out. Updated both selector filters to `{ hasText: "On Hand" }`:
    ```ts
    await page.locator("th").filter({ hasText: "On Hand" }).click();
    await expect(page.locator("th").filter({ hasText: "On Hand" }).locator("svg")).toBeVisible();
    ```
- **Commit:** `d302ab5 test(e2e): disambiguate revenue locator and update stock header locator to on hand in admin-panel spec`

---

### Item 2 — `checkout-flow.spec.ts` fabricated cart product id causing empty cart

- **File:** `artifacts/store/tests/e2e/checkout-flow.spec.ts`
- **Problems & Changes:**
  - Shared `beforeEach` directly injected a fake non-UUID `product_id: "test-product-id"` into `localStorage`.
  - When `CheckoutPage.tsx` mounts, it POSTs cart product IDs to `/api/products/prices`. Because `products.id` is a UUID column in Postgres, the non-UUID identifier causes the query to fail and return an empty price map `{}`.
  - As a result, `CheckoutPage.tsx` treated the product as nonexistent, emptied the cart, and displayed the empty cart view with no `<h1>` and no checkout form. This triggered cascading failures across all 4 checkout flow tests.
  - Replaced the fabricated localStorage insertion in `beforeEach` with real product addition through the storefront UI:
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
  - In `"checkout page shows order summary"`, relaxed the assertion from the hardcoded `"text=Test Product"` to structural verification of the order summary list item (`const orderItem = page.locator("ul li").first(); await expect(orderItem).toBeVisible({ timeout: 5_000 });`) and disambiguated the AZN locator with `.first()`.
- **Commit:** `690cad6 test(e2e): populate cart with real product via storefront in checkout-flow spec`

---

### Item 3 — `search-and-navigation.spec.ts` ambiguous back-to-products link

- **File:** `artifacts/store/tests/e2e/search-and-navigation.spec.ts`
- **Problems & Changes:**
  - In test `"non-existent product shows 404 page"` (line 69), `page.locator("a[href*='/products']")` resolved to 6 matching links across the page header, footer, bottom nav, and content, triggering a strict-mode violation.
  - Added `.first()` to disambiguate:
    ```ts
    const backLink = page.locator("a[href*='/products']").first();
    await expect(backLink).toBeVisible();
    ```
- **Commit:** `16e33c8 test(e2e): disambiguate back-to-products locator in search-and-navigation spec`

---

### Item 4 — `storefront-browsing.spec.ts` grid selector matched Lucide SVG icon

- **File:** `artifacts/store/tests/e2e/storefront-browsing.spec.ts`
- **Problems & Changes:**
  - In test `"products page displays product grid"` (line 35), `page.locator('[class*="grid"]').first()` matched a preceding `<svg class="lucide lucide-grid3x3 lucide-grid-3x3">` view-toggle icon instead of the product grid container `<div className="grid grid-cols-2 ...">`, failing with `Received: hidden`.
  - Scoped the selector to a `div` element:
    ```ts
    const productGrid = page.locator('div[class*="grid"]').first();
    await expect(productGrid).toBeVisible({ timeout: 15_000 });
    ```
- **Commit:** `1aa9443 test(e2e): scope product grid locator to div in storefront-browsing spec`

---

## 3. Verification & Command Outputs

The following local verification commands were executed. The `integration-e2e` suite requires a running API server, a running storefront server, and live Supabase credentials; it is run in CI (`.github/workflows/test.yml`), not in a bare local checkout.

### Tiers Executed Locally:
1. `pnpm run typecheck`
2. `pnpm run audit:invariants:strict`
3. `pnpm run test:unit`

### Command Outputs:

#### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> tsc --build

Scope: 5 of 10 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

#### `pnpm run audit:invariants:strict`
```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
ok    on-hand-repair-setting-isolation 0 total, 0 new
ok    no-direct-variant-costs-writes   0 total, 0 new
ok    no-cost-column-on-staff-tables   0 total, 0 new
ok    no-private-columns-on-anon-grants 0 total, 0 new
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new

All invariant checks passed.
```

#### `pnpm run test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/davam-840a9f

 Test Files  58 passed (58)
      Tests  670 passed (670)
   Start at  22:00:57
   Duration  15.98s
```

---

## 4. Operational Guardrails

- No migrations were run against any remote Supabase project.
- No Supabase secrets or credentials were read or modified.
- No commits were made to `main`.
- Remote repository was not pushed to.
