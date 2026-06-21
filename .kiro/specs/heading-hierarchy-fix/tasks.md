# Implementation Plan

## Overview

Fix heading hierarchy violations (WCAG 1.3.1) where product listing pages skip from `<h1>` to `<h3>`, and the Footer uses `<h4>` elements that skip levels. The fix introduces a configurable `headingLevel` prop on `ProductCard`/`ProductGrid`, adjusts WishlistPage inline headings, and replaces Footer `<h4>` with styled `<p>` elements.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1", "3.5"] },
    { "id": 2, "tasks": ["3.2", "3.4"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["3.6", "3.7"] },
    { "id": 5, "tasks": ["4"] }
  ]
}
```

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Heading Level Skip on Listing Pages and Footer
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate heading levels are skipped (h1 → h3, h4 in footer)
  - **Scoped PBT Approach**: Generate random product data (title, price, slug) and render ProductCard without headingLevel prop; assert it renders `<h2>` (expected behavior). Also render Footer and assert no `<h4>` elements exist. Generate random arrays of products and render ProductGrid without headingLevel; assert output contains `<h2>` product titles.
  - Test file: `artifacts/store/src/__tests__/heading-hierarchy.property.test.ts`
  - Test cases from Bug Condition in design:
    - Render `ProductCard` with random product data (no headingLevel prop) → assert heading is `<h2>` (will FAIL on unfixed code since it renders `<h3>`)
    - Render `ProductGrid` with random products (no headingLevel prop) → assert all product headings are `<h2>` (will FAIL)
    - Render `Footer` component → assert no `<h4>` elements in output (will FAIL on unfixed code)
    - For WishlistPage: assert product titles render as `<h2>` (will FAIL on unfixed code since inline `<h3>` is used)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: e.g., "ProductCard renders `<h3>` instead of expected `<h2>`", "Footer renders `<h4>Store</h4>` instead of non-heading element"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Nested Context Heading Levels Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Test file: `artifacts/store/src/__tests__/heading-hierarchy.property.test.ts` (same file, separate describe block)
  - Observe on UNFIXED code:
    - `ProductCard` with no headingLevel prop renders `<h3>` (this is the DEFAULT and correct for nested contexts)
    - `ProductCard` with `headingLevel={3}` renders `<h3>` (explicit nested context)
    - HomePage sections (Featured, On Sale) use `<h2>` section headings followed by `<h3>` product titles — correct nesting
    - ProductDetail "Related Products" uses `<h2>` then `<h3>` product titles — correct nesting
  - Write property-based tests capturing observed behavior:
    - For all random product data, `ProductCard` with `headingLevel={3}` (or default) MUST render `<h3>` — preserves backward compatibility
    - For all random product data, `ProductCard` with explicit `headingLevel={2}` MUST render `<h2>` — validates prop works correctly
    - For all random product data arrays, `ProductGrid` with no headingLevel MUST render `<h3>` for all product titles (default behavior preserved)
    - Footer column labels must retain same visual styling classes (`font-semibold mb-3 text-sm text-foreground`) regardless of element change
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve — default is h3)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix heading hierarchy violations

  - [x] 3.1 Add `headingLevel` prop to ProductCard component
    - Add optional `headingLevel?: 2 | 3` to Props interface (default `3` for backward compatibility)
    - Replace hardcoded `<h3>` with dynamic heading: `const Heading = headingLevel === 2 ? 'h2' : 'h3'`
    - Render `<Heading>` with same class names (`font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors duration-200 leading-snug`)
    - File: `artifacts/store/src/components/storefront/ProductCard.tsx`
    - _Bug_Condition: isBugCondition(element) where headingLevel skip > 1 from parent_
    - _Expected_Behavior: ProductCard renders heading matching headingLevel prop value_
    - _Preservation: Default headingLevel=3 preserves all existing nested contexts (HomePage sections, ProductDetail)_
    - _Requirements: 2.1, 3.1, 3.2_

  - [x] 3.2 Add `headingLevel` prop to ProductGrid component
    - Add optional `headingLevel?: 2 | 3` to ProductGridProps interface
    - Forward `headingLevel` prop to each `ProductCard` instance rendered
    - File: `artifacts/store/src/components/storefront/ProductGrid.tsx`
    - _Bug_Condition: ProductGrid does not propagate heading context to ProductCard_
    - _Expected_Behavior: ProductGrid passes headingLevel to all child ProductCard instances_
    - _Preservation: No headingLevel passed = default h3 behavior unchanged_
    - _Requirements: 2.1_

  - [x] 3.3 Pass `headingLevel={2}` on listing pages
    - ProductsPage: Pass `headingLevel={2}` to `ProductGrid` (page has h1, needs h2 for products)
    - CategoryPage: Pass `headingLevel={2}` to `ProductGrid` (page has h1, needs h2 for products)
    - Files: `artifacts/store/src/pages/storefront/ProductsPage.tsx`, `artifacts/store/src/pages/storefront/CategoryPage.tsx`
    - _Bug_Condition: Listing pages have h1 → h3 skip_
    - _Expected_Behavior: Listing pages produce h1 → h2 sequential hierarchy_
    - _Preservation: HomePage/ProductDetail not changed (they already have h2 sections)_
    - _Requirements: 2.1_

  - [x] 3.4 Change WishlistPage inline `<h3>` to `<h2>`
    - Replace the `<h3>` element wrapping product titles in the wishlist grid with `<h2>`
    - Preserve existing class names: `font-medium text-sm line-clamp-2 hover:text-primary transition`
    - File: `artifacts/store/src/pages/storefront/WishlistPage.tsx`
    - _Bug_Condition: WishlistPage has h1 → h3 skip (inline heading, not via ProductCard)_
    - _Expected_Behavior: WishlistPage produces h1 → h2 sequential hierarchy_
    - _Requirements: 2.2_

  - [x] 3.5 Replace Footer `<h4>` elements with styled `<p>` elements
    - Change all `<h4>` column headings (Store, Info, Contact) to `<p>` elements
    - Preserve existing visual classes (`font-semibold mb-3 text-sm text-foreground`)
    - Footer column labels are visual labels for navigation lists, not document outline headings
    - No `aria-label` or `role="heading"` needed — footer is within `<footer>` landmark
    - File: `artifacts/store/src/components/storefront/Footer.tsx`
    - _Bug_Condition: Footer uses h4 elements which skip heading levels_
    - _Expected_Behavior: Footer produces no heading elements, eliminating hierarchy skip_
    - _Requirements: 2.3_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Heading Level Sequential on Listing Pages and Footer
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (h2 for listing pages, no h4 in footer)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run: `pnpm exec vitest --run --project store-unit artifacts/store/src/__tests__/heading-hierarchy.property.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Nested Context Heading Levels Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm: ProductCard default (no prop) still renders h3, explicit headingLevel={3} still renders h3, HomePage/ProductDetail contexts unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `pnpm exec vitest --run --project store-unit`
  - Run typecheck: `pnpm run typecheck`
  - Verify no existing tests broken by the changes
  - Run Lighthouse accessibility audit on a listing page to confirm heading hierarchy passes WCAG 1.3.1
  - Ensure all tests pass, ask the user if questions arise


## Notes

- Property-based tests use fast-check to generate random product data (title, price, slug, image) and validate heading element output
- The `headingLevel` prop defaults to `3` ensuring zero breaking changes for existing consumers (HomePage, ProductDetail)
- Footer fix uses `<p>` instead of `<h2>` because column labels are navigation landmarks, not document outline headings
- Test file location: `artifacts/store/src/__tests__/heading-hierarchy.property.test.ts`
- Run tests with: `pnpm exec vitest --run --project store-unit`
