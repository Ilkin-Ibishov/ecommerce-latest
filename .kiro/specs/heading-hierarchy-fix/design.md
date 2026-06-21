# Heading Hierarchy Fix — Bugfix Design

## Overview

Product listing pages and the footer violate WCAG 1.3.1 by skipping heading levels in the document outline. `ProductCard` hardcodes `<h3>` for product titles, which is correct when nested under an `<h2>` section but incorrect on listing pages where it sits directly under an `<h1>`. The `WishlistPage` has the same issue with inline `<h3>` product titles. The `Footer` uses `<h4>` column headings which also skip levels.

The fix introduces a configurable `headingLevel` prop on `ProductCard` and `ProductGrid`, adjusts the `WishlistPage` inline headings, and replaces Footer `<h4>` elements with styled `<p>` elements (since footer column labels are not structural headings in the document outline).

## Glossary

- **Bug_Condition (C)**: A heading element that skips one or more levels relative to its parent heading in the document outline (e.g., h1 → h3 skipping h2)
- **Property (P)**: The desired behavior — all heading elements follow sequential order without skipping levels (h1 → h2 → h3)
- **Preservation**: Existing correct heading nesting in contexts where `ProductCard` is rendered under an `<h2>` section heading (HomePage sections, ProductDetail "Related Products")
- **ProductCard**: The component in `components/storefront/ProductCard.tsx` that renders individual product titles as heading elements
- **ProductGrid**: The shared grid component in `components/storefront/ProductGrid.tsx` that renders a collection of `ProductCard` components
- **headingLevel**: A new prop (`2 | 3`) that controls which HTML heading element (`<h2>` or `<h3>`) is rendered for the product title

## Bug Details

### Bug Condition

The bug manifests when `ProductCard` renders on a page where the parent context has only an `<h1>` as the preceding heading — no intermediate `<h2>` section heading exists. The hardcoded `<h3>` skips the `<h2>` level, violating WCAG 1.3.1. Similarly, `WishlistPage` uses inline `<h3>` elements for product titles directly under its `<h1>`. The `Footer` uses `<h4>` column headings which skip levels regardless of context.

**Formal Specification:**
```
FUNCTION isBugCondition(element)
  INPUT: element of type HeadingElement
  OUTPUT: boolean
  
  LET parentHeadingLevel = nearestAncestorHeadingLevel(element)
  LET elementLevel = element.headingLevel
  
  RETURN (elementLevel - parentHeadingLevel) > 1
         OR (element IS FooterColumnHeading AND element.tagName IN ['h3', 'h4'])
END FUNCTION
```

### Examples

- **ProductsPage**: `<h1>All Products</h1>` → `<h3>iPhone 15</h3>` — skips h2 (BUG)
- **CategoryPage**: `<h1>Electronics</h1>` → `<h3>Samsung Galaxy</h3>` — skips h2 (BUG)
- **WishlistPage**: `<h1>Wishlist</h1>` → `<h3>Saved Item</h3>` — skips h2 (BUG)
- **Footer**: `<h4>Store</h4>`, `<h4>Info</h4>`, `<h4>Contact</h4>` — skips levels (BUG)
- **HomePage "Featured"**: `<h2>Featured</h2>` → `<h3>Product</h3>` — correct nesting (NOT A BUG)
- **ProductDetail "Related Products"**: `<h2>Related Products</h2>` → `<h3>Product</h3>` — correct nesting (NOT A BUG)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `ProductCard` rendered inside HomePage sections (Featured, On Sale) that have an `<h2>` section heading must continue to use `<h3>` for product titles
- `ProductCard` rendered inside ProductDetail "Related Products" (under `<h2>`) must continue to use `<h3>` for product titles
- HomePage "Deal of the Day" `<h3>` under its `<h2>` section heading must remain unchanged
- All page-level `<h1>` titles must remain as `<h1>`
- ProductDetail section headings (Specs, Reviews, Related) must remain as `<h2>`
- All existing visual styling of headings must be preserved (font-size, weight, line-clamp)

**Scope:**
All inputs that do NOT involve heading elements on listing pages or the footer should be completely unaffected by this fix. This includes:
- Product card layout, images, badges, pricing, cart functionality
- Mouse interactions and keyboard events
- Responsive behavior and animations
- Cart context integration within ProductCard

## Hypothesized Root Cause

Based on the bug analysis, the root causes are:

1. **Hardcoded heading level in ProductCard**: The `ProductCard` component unconditionally renders `<h3>` (line ~128 in the component) without considering its structural context. When used on listing pages (ProductsPage, CategoryPage) where only `<h1>` exists, this creates an h1 → h3 skip.

2. **ProductGrid passes no heading context**: The `ProductGrid` component does not accept or propagate a heading level — it always renders `ProductCard` with the default `<h3>`.

3. **WishlistPage inline headings**: The `WishlistPage` renders product titles as `<h3>` inline without using `ProductCard`, hardcoding the wrong level for its h1 → h3 context.

4. **Footer uses semantic heading elements for non-structural labels**: The `Footer` component uses `<h4>` for column labels ("Store", "Info", "Contact") which are navigation/landmark labels rather than document outline headings. Using heading elements here creates skipped levels.

## Correctness Properties

Property 1: Bug Condition - Heading Level Sequencing on Listing Pages

_For any_ page where `ProductCard` or inline product titles render directly under an `<h1>` page title (ProductsPage, CategoryPage, WishlistPage), the fixed components SHALL render product titles as `<h2>` elements, ensuring no heading level is skipped in the document outline.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Footer Heading Levels

_For any_ page that renders the `Footer` component, the fixed footer SHALL NOT use heading elements for column labels (replacing `<h4>` with styled `<p>` elements or equivalent non-heading markup), ensuring no heading levels are skipped in the document outline.

**Validates: Requirements 2.3**

Property 3: Preservation - Nested Context Heading Levels

_For any_ page where `ProductCard` renders inside a section with an `<h2>` heading (HomePage "Featured"/"On Sale" sections, ProductDetail "Related Products"), the fixed components SHALL continue to render product titles as `<h3>` elements, preserving the correct h2 → h3 nesting.

**Validates: Requirements 3.1, 3.2, 3.3**

## Fix Implementation

### Changes Required

**File**: `artifacts/store/src/components/storefront/ProductCard.tsx`

**Specific Changes**:
1. **Add `headingLevel` prop**: Add an optional `headingLevel?: 2 | 3` prop to the `Props` interface, defaulting to `3` to preserve backward compatibility.
2. **Dynamic heading element**: Replace the hardcoded `<h3>` with a dynamic heading element based on the prop. Use a variable like `const Heading = headingLevel === 2 ? 'h2' : 'h3'` and render `<Heading>` with the same class names.

**File**: `artifacts/store/src/components/storefront/ProductGrid.tsx`

**Specific Changes**:
3. **Add `headingLevel` prop to ProductGridProps**: Add an optional `headingLevel?: 2 | 3` prop to the `ProductGridProps` interface.
4. **Pass through to ProductCard**: Forward the `headingLevel` prop to each `ProductCard` instance.

**File**: `artifacts/store/src/pages/storefront/ProductsPage.tsx`

**Specific Changes**:
5. **Pass `headingLevel={2}` to ProductGrid**: Since this page has h1 as parent, product cards need h2.

**File**: `artifacts/store/src/pages/storefront/CategoryPage.tsx`

**Specific Changes**:
6. **Pass `headingLevel={2}` to ProductGrid**: Since this page has h1 as parent, product cards need h2.

**File**: `artifacts/store/src/pages/storefront/WishlistPage.tsx`

**Specific Changes**:
7. **Change inline `<h3>` to `<h2>`**: Replace the `<h3>` element wrapping product titles in the wishlist grid with `<h2>`, preserving the existing class names (`font-medium text-sm line-clamp-2`).

**File**: `artifacts/store/src/pages/storefront/HomePage.tsx`

**Specific Changes**:
8. **No changes needed for local ProductGrid**: The local `ProductGrid` function in `HomePage.tsx` already uses `<h2>` section headings before rendering `ProductCard`. Since `headingLevel` defaults to `3`, existing correct behavior is preserved automatically.

**File**: `artifacts/store/src/components/storefront/ProductDetail.tsx`

**Specific Changes**:
9. **No changes needed**: Related Products section already has `<h2>` before the `ProductCard` instances. Since `headingLevel` defaults to `3`, existing correct behavior is preserved automatically.

**File**: `artifacts/store/src/components/storefront/Footer.tsx`

**Specific Changes**:
10. **Replace `<h4>` with `<p>`**: Change all three `<h4>` elements (Store, Info, Contact column headings) to `<p>` elements, keeping the same classes (`font-semibold mb-3 text-sm text-foreground`). Footer column labels serve as visual labels for navigation lists, not document outline headings. Adding `aria-label` on the parent `<div>` or using `role="heading" aria-level="2"` is unnecessary since the footer is within a `<footer>` landmark and screen readers announce the landmark.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the heading hierarchy violations on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the heading skip BEFORE implementing the fix. Confirm the root cause is hardcoded heading elements.

**Test Plan**: Write tests that render each affected component/page and inspect the resulting heading hierarchy. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **ProductCard renders h3**: Render `ProductCard` and assert it produces `<h3>` — confirms current behavior (will pass on unfixed code, demonstrating the bug condition)
2. **ProductGrid produces no h2**: Render `ProductGrid` with products and verify no `<h2>` exists in output (will pass on unfixed code, confirming bug)
3. **WishlistPage heading skip**: Render WishlistPage grid and check that `<h3>` follows `<h1>` with no `<h2>` (confirms bug on unfixed code)
4. **Footer h4 presence**: Render Footer and assert `<h4>` elements exist (confirms bug condition on unfixed code)

**Expected Counterexamples**:
- Heading hierarchy check detects h1 → h3 jumps on ProductsPage, CategoryPage, WishlistPage
- Footer produces h4 elements that skip h2 and h3

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed components produce the correct heading hierarchy.

**Pseudocode:**
```
FOR ALL page WHERE isBugCondition(page) DO
  renderedHeadings := extractHeadings(renderPage(page))
  ASSERT isSequential(renderedHeadings)
  -- No heading level is skipped (difference between consecutive levels <= 1)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed components produce the same heading output as the original.

**Pseudocode:**
```
FOR ALL context WHERE NOT isBugCondition(context) DO
  -- Contexts: HomePage sections, ProductDetail Related Products
  ASSERT renderProductCard_fixed(context).headingLevel = renderProductCard_original(context).headingLevel
  -- Both should produce <h3> in nested contexts
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It can generate many combinations of heading contexts and product data
- It catches regressions where the default heading level might accidentally change
- It validates that the `headingLevel` prop correctly maps to the expected HTML element across all valid inputs

**Test Plan**: Observe heading output on UNFIXED code first for HomePage and ProductDetail contexts, then write property-based tests capturing that behavior.

**Test Cases**:
1. **HomePage section preservation**: Verify that ProductCard within HomePage sections (under h2) continues to render h3 after fix
2. **ProductDetail related preservation**: Verify that ProductCard within Related Products (under h2) continues to render h3 after fix
3. **ProductCard default behavior**: Verify that ProductCard without explicit headingLevel prop renders h3 (backward compatible)
4. **Footer visual preservation**: Verify that footer column labels retain same visual styling despite element change

### Unit Tests

- Test `ProductCard` renders `<h2>` when `headingLevel={2}` is passed
- Test `ProductCard` renders `<h3>` when `headingLevel={3}` or no prop is passed (default)
- Test `ProductGrid` passes `headingLevel` to child `ProductCard` instances
- Test Footer renders `<p>` instead of `<h4>` for column headings
- Test WishlistPage renders `<h2>` for product titles

### Property-Based Tests

- Generate random `headingLevel` values (2 or 3) and random product data; verify ProductCard always renders the correct heading tag matching the prop value
- Generate random arrays of products with random heading levels; verify ProductGrid propagates the level correctly to all children
- Generate page context scenarios (listing vs. nested); verify the heading hierarchy is always sequential (no skips)

### Integration Tests

- Render full ProductsPage and validate complete heading hierarchy (h1 followed by h2 elements, no skips)
- Render full CategoryPage and validate heading sequence
- Render full WishlistPage and validate heading sequence
- Render full HomePage and validate that h2 sections still contain h3 product titles
- Render Footer in isolation and validate no heading elements exist in output
