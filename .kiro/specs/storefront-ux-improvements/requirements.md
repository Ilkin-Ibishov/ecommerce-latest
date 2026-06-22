# Requirements Document

## Introduction

This document specifies 9 UI/UX improvement components for the white-label e-commerce storefront. The improvements enhance product browsing, cart interaction feedback, loading states, navigation, and notification experiences. All components integrate with the existing React 19 SPA using Tailwind v4, TypeScript strict mode, the useI18n() hook for translations, and the useCart() context for cart operations.

## Glossary

- **Storefront**: The customer-facing React SPA served under locale-prefixed routes (e.g., `/az/`, `/ru/`, `/en/`)
- **Product_Gallery**: The existing `ProductGallery.tsx` component that displays product images with lightbox, swipe navigation, and thumbnail strip
- **Product_Card**: The existing `ProductCard.tsx` component used in product listing grids
- **Cart_Context**: The React context (`useCart()`) providing cart state and mutation methods (addItem, removeItem, updateQty, getItemQty)
- **I18n_Context**: The React context (`useI18n()`) providing the `t()` translation function and current locale
- **Category_Tree**: The hierarchical category data structure returned by `getCategoriesTree()` from `lib/queries/categories.ts`
- **Magnifier_Lens**: A circular or rectangular overlay region that shows a zoomed portion of the product image following cursor position
- **Sticky_Bar**: A fixed-position UI element that remains visible regardless of scroll position
- **IntersectionObserver**: A browser API that detects when an element enters or exits the viewport
- **Quick_View_Modal**: A dialog overlay showing condensed product information without navigating away from the listing page
- **Shimmer_Animation**: A CSS gradient animation that sweeps across skeleton placeholder elements to indicate loading
- **Breadcrumb**: A hierarchical navigation pattern showing the path from root to current page
- **Size_Guide_Overlay**: A modal or drawer presenting tabular size measurement data
- **Scroll_Snap**: A CSS feature that aligns scroll positions to defined snap points after user scroll interaction
- **Toast_Notification**: A brief, auto-dismissing message overlay communicating action outcomes to the user
- **Primary_CTA**: The main "Add to Cart" button in the product page's above-the-fold section
- **Viewport**: The visible area of the browser window

## Requirements

### Requirement 1: Product Image Magnifier

**User Story:** As a shopper, I want to hover over a product image to see a magnified view, so that I can inspect product details without opening the lightbox.

#### Acceptance Criteria

1. WHEN the user hovers over the main product image while the viewport width is 768px or greater, THE Product_Gallery SHALL display a Magnifier_Lens of 150px × 150px minimum that shows a zoomed crop of the image at 2.5x magnification centered on the cursor position
2. WHILE the user moves the cursor over the main product image, THE Magnifier_Lens SHALL reposition to follow the cursor coordinates within 16ms (one animation frame), keeping the zoomed region centered on the cursor and clamping the lens so it does not extend beyond the main image boundary
3. WHEN the cursor leaves the main product image boundary, THE Product_Gallery SHALL hide the Magnifier_Lens within 100ms
4. WHEN the user performs a pinch gesture on the main product image on a touch device, THE Product_Gallery SHALL zoom the image from a minimum of 1x to a maximum of 4x proportionally to the pinch distance
5. WHILE the viewport width is below 768px, THE Product_Gallery SHALL disable hover-based magnification and enable touch-based pinch-to-zoom
6. WHILE the Magnifier_Lens is actively visible to the user, WHEN the user clicks the main product image, THE Product_Gallery SHALL open the lightbox overlay (the lens may remain visible during the lightbox opening transition)
7. THE Magnifier_Lens SHALL render with a 1px solid border and a box-shadow offset of at least 2px to visually distinguish it from the base image
8. IF the source product image has a natural resolution below the magnified display size (natural width less than display width multiplied by 2.5), THEN THE Product_Gallery SHALL not activate the Magnifier_Lens on hover for that image

### Requirement 2: Sticky Add-to-Cart Bar for Mobile

**User Story:** As a mobile shopper, I want a persistent add-to-cart bar at the bottom of the screen, so that I can add products to my cart without scrolling back to the top.

#### Acceptance Criteria

1. WHEN the user scrolls past the Primary_CTA on the product page and the viewport width is below 1024px, THE Sticky_Bar SHALL appear fixed at the bottom of the viewport with a slide-up transition completing within 200ms
2. WHEN the Primary_CTA re-enters the viewport, THE Sticky_Bar SHALL hide with a slide-down transition completing within 200ms
3. THE Sticky_Bar SHALL display the product title truncated to a single line with CSS text-overflow ellipsis and a maximum width of 50% of the bar width, the current price formatted with currency, and an "Add to Cart" button
4. WHEN the user taps the "Add to Cart" button on the Sticky_Bar, THE Cart_Context SHALL receive an addItem call with the product's product_id, slug, title, price, and image, using a quantity of 1
5. WHILE the viewport width is 1024px or above, THE Sticky_Bar SHALL remain hidden regardless of scroll position
6. THE Sticky_Bar SHALL use translated text from the I18n_Context for all visible labels including the "Add to Cart" and "Out of Stock" button text
7. THE Sticky_Bar SHALL have a z-index higher than the page content z-index and lower than the modal overlay z-index as defined by the application's stacking context
8. IF the product is out of stock, THEN THE Sticky_Bar SHALL display a disabled button with an "Out of Stock" label instead of "Add to Cart"
9. WHILE the Sticky_Bar is visible, THE Sticky_Bar SHALL not overlap or obscure the page's bottom navigation or cookie banner if present

### Requirement 3: Quick View Modal

**User Story:** As a shopper browsing product listings, I want to preview product details in a modal, so that I can evaluate products without leaving the listing page.

#### Acceptance Criteria

1. WHEN the user hovers over a Product_Card on a desktop viewport (width 768px or above), THE Product_Card SHALL display a "Quick View" button overlay
2. WHEN the user clicks the "Quick View" button, THE Storefront SHALL open a Quick_View_Modal containing the product's first image, price, variant selector (if the product has variants), and an "Add to Cart" button
3. WHEN the user clicks the "Add to Cart" button inside the Quick_View_Modal, THE Cart_Context SHALL receive an addItem call with the selected variant (or default product if no variants exist) and a quantity of 1
4. IF the user clicks the "Add to Cart" button inside the Quick_View_Modal but no variant is selected for a product that has variants, THEN THE Quick_View_Modal SHALL display an inline error message indicating that a variant must be selected and SHALL NOT call addItem
5. WHEN the user clicks outside the Quick_View_Modal or presses the Escape key, THE Quick_View_Modal SHALL close and return focus to the "Quick View" button that triggered it
6. THE Quick_View_Modal SHALL use translated text from the I18n_Context for all labels including button text and variant labels
7. THE Quick_View_Modal SHALL trap keyboard focus within the modal while open
8. THE Quick_View_Modal SHALL be accessible by keyboard: the "Quick View" trigger button must have an aria-label, and the modal must have role="dialog" and aria-modal="true"
9. WHILE the viewport width is below 768px, THE Product_Card SHALL display the "Quick View" button persistently (visible without hover) at a smaller size than the desktop overlay button

### Requirement 4: Animated Add-to-Cart Feedback

**User Story:** As a shopper, I want rich visual feedback when I add an item to cart, so that I am confident the action completed successfully.

#### Acceptance Criteria

1. WHEN the user clicks any "Add to Cart" button, THE button SHALL animate through a morph sequence: original state → loading spinner (displayed only when the add-to-cart operation involves an asynchronous network request) → checkmark icon with the theme's success semantic color (e.g., green-500 or equivalent design-token)
2. WHEN the add-to-cart action completes, THE Cart badge in the header SHALL animate with a bounce effect that scales to 1.3× and returns to 1.0× over 300ms
3. THE morph animation SHALL complete within 600ms from trigger to checkmark display
4. THE button SHALL return to its original state after 1800ms following the success animation
5. THE animation SHALL use CSS transitions and keyframes without introducing external animation library dependencies
6. IF the add-to-cart action fails, THEN THE button SHALL display an error shake animation (horizontal displacement of 4px, 3 oscillations over 400ms) and revert to its original interactive state within 600ms of the failure
7. THE animated feedback SHALL apply consistently across all add-to-cart surfaces: Product_Card, Quick_View_Modal, Sticky_Bar, and the product page Primary_CTA
8. WHILE the morph animation is in progress (from click through the 1800ms reset), THE button SHALL be non-interactive (ignore subsequent clicks) to prevent duplicate additions
9. IF the user has enabled reduced-motion preferences (prefers-reduced-motion: reduce), THEN THE system SHALL skip all motion animations and instead display the appropriate outcome feedback immediately without transition (checkmark for success, error state for failure)

### Requirement 5: Skeleton Shimmer Loading States

**User Story:** As a shopper, I want to see animated placeholder content while pages load, so that I perceive faster load times and understand the page structure.

#### Acceptance Criteria

1. THE Storefront SHALL provide a reusable Shimmer component that renders a CSS linear-gradient animation sweeping left-to-right with a cycle duration between 1.2 and 2.0 seconds, repeating infinitely until unmounted
2. WHILE the product page data is loading, THE Storefront SHALL display a ProductPage skeleton layout containing placeholder blocks for the gallery area, title, price, description, and variants sections, each wrapped in the Shimmer component
3. WHILE the cart drawer is open and cart item details are being fetched, THE CartDrawer SHALL display a skeleton layout containing placeholder blocks for up to 3 item rows and a totals area, each wrapped in the Shimmer component
4. WHILE the category page data is loading, THE Storefront SHALL display a CategoryPage skeleton layout using a grid of shimmer-animated ProductSkeleton cards with a default count of 8 cards
5. THE Shimmer component SHALL accept className and children props, rendering the shimmer animation across its children elements and allowing layout customization via className
6. THE shimmer animation SHALL use a single CSS @keyframes definition shared across all skeleton instances
7. IF the user has enabled prefers-reduced-motion, THEN THE Storefront SHALL skip skeleton shimmer layouts entirely and display a simple loading spinner instead
8. THE existing ProductSkeleton component SHALL render the Shimmer component internally in place of directly applying the shimmer CSS class, preserving its current visual dimensions and structure
9. WHEN page data finishes loading, THE Storefront SHALL replace the skeleton layout with the actual content without intermediate blank states

### Requirement 6: Breadcrumb Navigation

**User Story:** As a shopper, I want to see a breadcrumb trail showing my location in the category hierarchy, so that I can navigate back to parent categories easily.

#### Acceptance Criteria

1. WHEN a product page is displayed, THE Storefront SHALL render a Breadcrumb showing: Home > Category > Subcategory > Product Title
2. WHEN a category page is displayed, THE Storefront SHALL render a Breadcrumb showing: Home > Category (> Subcategory if applicable)
3. WHEN the user clicks a Breadcrumb segment, THE Storefront SHALL navigate to the corresponding route
4. THE Breadcrumb SHALL resolve category hierarchy using the existing Category_Tree data from `lib/queries/categories.ts`
5. THE Breadcrumb SHALL use translated category names and labels from the I18n_Context
6. THE Breadcrumb SHALL render the final segment (current page) as non-clickable text distinguished from clickable ancestors
7. THE Breadcrumb component SHALL include structured data markup (JSON-LD BreadcrumbList schema) for search engine optimization
8. THE Breadcrumb component SHALL use an aria-label of "Breadcrumb" on its nav element and aria-current="page" on the final segment

### Requirement 7: Size Guide Overlay

**User Story:** As a shopper, I want to view a size chart for the product I am considering, so that I can select the correct size variant.

#### Acceptance Criteria

1. WHEN a product has at least one variant attribute representing a body or garment measurement size (e.g., S/M/L, numeric sizes), THE product page SHALL display a "Size Guide" link adjacent to the variant selector
2. WHEN the user clicks the "Size Guide" link, THE Storefront SHALL open a Size_Guide_Overlay containing a table with at least a size-label column and one measurement column, displaying a maximum of 20 size rows
3. WHEN the Size_Guide_Overlay opens, THE overlay SHALL display measurement data associated with the product's category as configured through the admin interface, within 500ms of the click
4. WHEN the user clicks outside the Size_Guide_Overlay or presses Escape, THE overlay SHALL close and return focus to the "Size Guide" link that triggered it
5. THE Size_Guide_Overlay SHALL use translated text from the I18n_Context for headers, labels, and measurement unit names
6. THE Size_Guide_Overlay SHALL trap keyboard focus while open and include role="dialog" with aria-modal="true"
7. IF no size guide data exists for the current product's category or if size guide data fails to load at runtime, THEN THE "Size Guide" link SHALL not render
8. IF size guide data fails to load after the user clicks the "Size Guide" link, THEN THE Size_Guide_Overlay SHALL display an error message indicating the data is unavailable and provide a close control

### Requirement 8: Recently Viewed Carousel Enhancement

**User Story:** As a shopper, I want a smooth, swipeable carousel for recently viewed products, so that I can browse my viewing history efficiently on all devices.

#### Acceptance Criteria

1. THE RecentlyViewed component SHALL apply CSS scroll-snap-type: x mandatory to its scroll container
2. THE RecentlyViewed component SHALL apply scroll-snap-align: start to each product card within the carousel
3. WHEN the user swipes horizontally on a touch device, THE carousel SHALL scroll to the nearest snap point using CSS scroll-behavior: smooth
4. THE carousel SHALL apply CSS scroll-behavior: smooth to its scroll container
5. WHILE the viewport width is 768px or above, WHEN the user hovers over the carousel container, THE carousel SHALL display a left arrow button and a right arrow button positioned at the left and right edges of the container
6. WHEN the user clicks a navigation arrow button, THE carousel SHALL scroll by the width of one fully visible card set (container visible width) in the corresponding direction
7. THE carousel arrow buttons SHALL have aria-label attributes with values that indicate the scroll direction (e.g., aria-label containing "previous" or "next" in the active locale)
8. IF all product cards are fully visible within the carousel container AND there is no horizontal overflow (scrollWidth <= clientWidth), THEN THE carousel SHALL not render navigation arrow buttons
9. WHILE the carousel is scrolled to its starting position (scrollLeft is 0), THE carousel SHALL hide the left navigation arrow button
10. WHILE the carousel is scrolled to its end position (scrollLeft + container width >= scroll width), THE carousel SHALL hide the right navigation arrow button

### Requirement 9: Toast Notification System

**User Story:** As a shopper, I want brief animated notifications confirming my actions, so that I receive immediate feedback without page disruption.

#### Acceptance Criteria

1. WHEN an item is added to the cart, THE Toast system SHALL display a notification with the product name using translated text from the I18n_Context for the message template
2. WHEN an item is saved to the wishlist, THE Toast system SHALL display a notification using translated text from the I18n_Context for the message template
3. WHEN a coupon is applied successfully, THE Toast system SHALL display a notification with the discount description using translated text from the I18n_Context for the message template
4. WHEN a user attempts to add an out-of-stock item, THE Toast system SHALL display a notification using the destructive variant styling to indicate a warning
5. THE Toast notifications SHALL animate in from the top on viewports below 640px width and from the bottom-right on viewports at or above 640px width, using CSS keyframe animations with a duration between 200ms and 400ms
6. THE Toast notifications SHALL auto-dismiss after 3000ms by default, accepting an optional duration parameter between 1000ms and 10000ms
7. THE Toast system SHALL extend the existing `use-toast.ts` hook with animation variant support and cart-specific template helpers
8. THE Toast notifications SHALL use translated text from the I18n_Context for all message templates, with keys defined in all supported locale files
9. THE Toast system SHALL support stacking up to 3 simultaneous notifications with vertical offset spacing of at least 8px between each notification
10. IF a new notification is triggered while exactly 3 notifications are already displayed, THEN THE Toast system SHALL dismiss the oldest notification before displaying the new one
11. WHEN a user activates the close control on a toast notification, THE Toast system SHALL immediately dismiss that notification with an animate-out transition
