# Bugfix Requirements Document

## Introduction

The product listing pages violate WCAG 1.3.1 (Info and Relationships) by skipping the `<h2>` heading level in the document outline. Pages with a product grid use `<h1>` for the page title and then jump directly to `<h3>` for individual product titles (via `ProductCard` component and inline product cards on `WishlistPage`). This broken heading hierarchy makes it difficult for screen reader users to understand the structural relationship between the page title and product items.

Additionally, the `HomePage` "Deal of the Day" featured product uses `<h3>` inside an `<h2>`-level section, which is correct nested usage and does NOT need changing. The `Footer` component uses `<h4>` headings for column titles — since footer content is typically within a `<footer>` landmark and follows the main page sections (`<h2>`), `<h4>` represents a skip from a semantic standpoint and should be evaluated.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a product listing page renders the `ProductCard` component THEN the system outputs product titles as `<h3>` elements, skipping the `<h2>` level in the heading hierarchy (h1 → h3)

1.2 WHEN the `WishlistPage` renders wishlist items inline THEN the system outputs product titles as `<h3>` elements, skipping the `<h2>` level (h1 → h3)

1.3 WHEN the `Footer` component renders column headings THEN the system outputs them as `<h4>` elements, which may skip heading levels depending on the preceding page structure

### Expected Behavior (Correct)

2.1 WHEN a product listing page renders the `ProductCard` component THEN the system SHALL output product titles as `<h2>` elements to maintain sequential heading order (h1 → h2)

2.2 WHEN the `WishlistPage` renders wishlist items inline THEN the system SHALL output product titles as `<h2>` elements to maintain sequential heading order (h1 → h2)

2.3 WHEN the `Footer` component renders column headings THEN the system SHALL output them as `<h2>` elements (or use non-heading elements with appropriate styling) to avoid skipping heading levels in the document outline

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the `ProductCard` is rendered inside a section that already has an `<h2>` heading (e.g., "Related Products" section on ProductDetail page, or named sections on HomePage) THEN the system SHALL CONTINUE TO use `<h3>` for product titles to maintain proper nesting (h2 → h3)

3.2 WHEN the `HomePage` "Deal of the Day" section renders a product title under its own `<h2>` section heading THEN the system SHALL CONTINUE TO use `<h3>` for the featured product title

3.3 WHEN the `ProductDetail` page renders section headings (Specs, Related Products, Reviews) THEN the system SHALL CONTINUE TO use `<h2>` for those section headings

3.4 WHEN the `SearchPage`, `CheckoutPage`, `ProfilePage`, or `CategoriesPage` render their section headings THEN the system SHALL CONTINUE TO use `<h2>` for those headings

3.5 WHEN any page renders its main title THEN the system SHALL CONTINUE TO use `<h1>` for the page title
