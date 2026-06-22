# Implementation Plan: Storefront UX Improvements

## Overview

This plan implements 9 UI/UX enhancement components for the storefront: Image Magnifier, Sticky Add-to-Cart Bar, Quick View Modal, Animated Cart Button, Skeleton Shimmer, Breadcrumb Navigation, Size Guide Overlay, Recently Viewed Carousel Enhancement, and Toast System Enhancement. Each task builds incrementally, starting with shared utilities and base components, then layering domain-specific features, and finally wiring everything together.

## Tasks

- [x] 1. Create shared utility functions and base Shimmer component
  - [x] 1.1 Create the reusable Shimmer component at `artifacts/store/src/components/ui/shimmer.tsx`
    - Wrap children in a `<div>` applying the existing `.shimmer` CSS class from `index.css` line 246
    - Accept `className` and `children` props per the `ShimmerProps` interface
    - Add `prefers-reduced-motion` media query check: render a Spinner component instead when motion is reduced
    - _Requirements: 5.1, 5.5, 5.6, 5.7_

  - [x] 1.2 Refactor `ProductSkeleton.tsx` to use the new Shimmer component internally
    - Replace direct `.shimmer` class usage with `<Shimmer>` wrapper
    - Preserve existing visual dimensions and structure
    - _Requirements: 5.8_

  - [x] 1.3 Add i18n keys for all 9 components across `az.ts`, `ru.ts`, `en.ts` locale files
    - Add keys for: magnifier alt text, sticky bar labels ("Add to Cart", "Out of Stock"), Quick View button/modal labels, breadcrumb "Home", size guide headers/labels/error, recently viewed arrow labels ("previous"/"next"), toast message templates (cart add, wishlist, coupon, out of stock)
    - _Requirements: 2.6, 3.6, 5.7, 6.5, 7.5, 8.7, 9.1, 9.2, 9.3, 9.4, 9.8_

- [x] 2. Implement AnimatedCartButton (shared across multiple surfaces)
  - [x] 2.1 Create `AnimatedCartButton` component at `artifacts/store/src/components/storefront/AnimatedCartButton.tsx`
    - Implement the state machine: idle → loading → success → idle (1800ms) and idle → loading → error → idle (600ms)
    - Morph animation using CSS transitions on width/background-color/border-radius
    - Loading spinner shown only when `onAdd` is async
    - Success state: checkmark icon + green-500 background
    - Error state: shake animation (3 oscillations, 4px displacement, 400ms)
    - `pointer-events: none` during non-idle states to prevent double-clicks
    - `prefers-reduced-motion`: skip transitions, show final state immediately
    - Accept `size` prop ("sm" | "md" | "lg") and `className` for flexibility across surfaces
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 2.2 Add cart badge bounce event to Header component
    - Dispatch custom event `cart-badge-bounce` from AnimatedCartButton on success
    - Modify `components/storefront/Header.tsx` to listen for the event on the cart badge span
    - Apply CSS class `animate-badge-bounce` (scale 1→1.3→1 over 300ms) and remove after animation
    - Add the `animate-badge-bounce` keyframe to Tailwind config or index.css
    - _Requirements: 4.2_

  - [x] 2.3 Write property test: AnimatedCartButton ignores clicks while not idle
    - **Property 4: AnimatedCartButton ignores clicks while not idle**
    - **Validates: Requirements 4.8**
    - Test file: `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
    - Use fast-check to generate random non-idle states, verify `onAdd` is never called

- [x] 3. Implement Toast System Enhancement
  - [x] 3.1 Enhance `artifacts/store/src/hooks/use-toast.ts`
    - Increase `TOAST_LIMIT` from 1 to 3
    - Change `TOAST_REMOVE_DELAY` to respect the per-toast `duration` parameter (default 3000ms)
    - Add `variant` field support ("default" | "destructive" | "success") to toast options
    - When 4th toast arrives, dismiss the oldest
    - Stacking with `gap-2` (8px) vertical offset between notifications
    - Animation: CSS keyframes `slide-in-from-top` on mobile (<640px), `slide-in-from-bottom-right` on desktop (≥640px)
    - Mobile top-positioned toasts must offset by `env(safe-area-inset-top, 0px)` or minimum `top: 1rem` to avoid notch/status bar overlap on iPhones
    - Close button triggers immediate `DISMISS_TOAST` with animate-out
    - _Requirements: 9.5, 9.6, 9.7, 9.9, 9.10, 9.11_

  - [x] 3.2 Create exported toast helper functions in `use-toast.ts`
    - `toastCartAdd(t, productName)` — success variant, cart add message template
    - `toastWishlist(t, productName)` — default variant, wishlist message
    - `toastCouponApplied(t, description)` — success variant, coupon message
    - `toastOutOfStock(t, productName)` — destructive variant, out-of-stock message
    - Each helper accepts `t` function from `useI18n()` for i18n access
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.8_

  - [x] 3.3 Write property tests for toast duration clamping and stack limit
    - **Property 7: Toast duration is clamped to valid range**
    - **Property 8: Toast stack never exceeds maximum limit**
    - **Validates: Requirements 9.6, 9.9, 9.10**
    - Test file: `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
    - Use fast-check: random durations (-10000 to 100000), random sequences of 1-50 toast additions

- [x] 4. Implement Image Magnifier
  - [x] 4.1 Create `ImageMagnifier` component at `artifacts/store/src/components/storefront/ImageMagnifier.tsx`
    - Extract pure function `computeLensPosition(imageRect, cursorPos, lensSize, magnification)` for testability
    - Desktop (≥768px): lens overlay tracking cursor via `requestAnimationFrame` at 60fps
    - Lens displays `background-image` at magnification× scale, centered on cursor
    - Clamp lens position within image bounds (never extends beyond boundary)
    - Hide lens within 100ms when cursor leaves image
    - 1px solid border + box-shadow ≥2px on lens
    - Resolution check: don't activate if `naturalWidth < displayWidth × magnification`
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8_

  - [x] 4.2 Add pinch-to-zoom for mobile in ImageMagnifier
    - Extract pure function `computePinchZoom(initialDistance, currentDistance)` → `clamp(current/initial, 1.0, 4.0)`
    - Track touch events (`touchstart`/`touchmove`/`touchend`) for two-finger distance
    - Apply CSS `transform: scale()` between 1× and 4×
    - Disable hover magnification below 768px viewport
    - **Gesture conflict handling**: Check `e.touches.length >= 2` to distinguish pinch from existing single-finger swipe navigation in `ProductGallery.tsx`. Set an `isPinching` flag that suppresses the gallery's `handleTouchEnd` carousel navigation while pinch is active.
    - Apply `touch-action: none` on the magnifier element during active pinch to prevent browser-level page zoom interference
    - _Requirements: 1.4, 1.5_

  - [x] 4.3 Integrate ImageMagnifier into `ProductGallery.tsx`
    - Wrap main image with ImageMagnifier component
    - Ensure lightbox still opens on click while lens is visible
    - _Requirements: 1.6_

  - [x] 4.4 Write property tests for magnifier lens clamping and pinch zoom
    - **Property 1: Magnifier lens position is clamped within image bounds**
    - **Property 2: Pinch-to-zoom scale is proportional and clamped**
    - **Validates: Requirements 1.1, 1.2, 1.4**
    - Test file: `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
    - Use fast-check: random image dims (100-4000px), cursor positions, lens sizes, finger distances

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Breadcrumb Navigation
  - [x] 6.1 Create `StorefrontBreadcrumb` component at `artifacts/store/src/components/storefront/StorefrontBreadcrumb.tsx`
    - Extract pure function `resolveBreadcrumbPath(categoryTree, targetCategoryId)` → ordered ancestor chain
    - Extract pure function `generateBreadcrumbJsonLd(segments, baseUrl)` → JSON-LD object
    - Build on existing `components/ui/breadcrumb.tsx` shadcn primitives
    - Render `nav` with `aria-label="Breadcrumb"`, final segment with `aria-current="page"`
    - Include JSON-LD `<script type="application/ld+json">` for SEO
    - Translate "Home" and category names via `t()` and `getTranslatedField()`
    - Graceful degradation: if category not found, render "Home" only
    - **Mobile overflow handling**: Apply `overflow-x-auto whitespace-nowrap` on the breadcrumb list container so long category chains scroll horizontally on narrow screens (320-375px) rather than wrapping or overflowing the viewport
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 6.2 Integrate StorefrontBreadcrumb into `ProductPage.tsx` and `CategoryPage.tsx`
    - Product page: Home > Category > Subcategory > Product Title
    - Category page: Home > Category (> Subcategory if applicable)
    - Use `getCategoriesTree()` from `lib/queries/categories.ts` for hierarchy resolution
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.3 Write property tests for breadcrumb path resolution and JSON-LD
    - **Property 5: Breadcrumb path resolution produces valid ancestor chain**
    - **Property 6: JSON-LD BreadcrumbList has correct structure**
    - **Validates: Requirements 6.1, 6.2, 6.4, 6.7**
    - Test file: `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
    - Use fast-check: random category trees (depth 1-5, breadth 1-4), random segment lists (1-10 items)

- [x] 7. Implement Sticky Add-to-Cart Bar
  - [x] 7.1 Create `StickyAddToCartBar` component at `artifacts/store/src/components/storefront/StickyAddToCartBar.tsx`
    - Use `IntersectionObserver` on `primaryCtaRef` to detect when main CTA leaves viewport
    - Fixed to bottom with `z-index: 45`, positioned with `bottom: calc(4rem + env(safe-area-inset-bottom, 0px))` on mobile (below md breakpoint) to clear both MobileBottomNav height and iPhone safe area insets
    - On md+ viewports (≥768px) where MobileBottomNav is hidden (`md:hidden`), position at `bottom: 0`
    - Slide-up/down transition via `transform: translateY()` with 200ms duration
    - Only renders on viewports <1024px (CSS `lg:hidden` + observer cleanup)
    - Display: product title (truncated, max 50% width), price, AnimatedCartButton
    - Call `addItem()` from `useCart()` on tap
    - Disable with "Out of Stock" label when `stock === 0`
    - All labels from `useI18n()` via `t()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 7.2 Integrate StickyAddToCartBar into the product page
    - Add a ref to the primary CTA button and pass it as `primaryCtaRef`
    - Pass product data (product_id, slug, title, price, image, stock)
    - _Requirements: 2.1, 2.4_

- [x] 8. Implement Quick View Modal
  - [x] 8.1 Create `QuickViewModal` component at `artifacts/store/src/components/storefront/QuickViewModal.tsx`
    - Built on existing `Dialog` from `components/ui/dialog.tsx` (Radix)
    - Fetch product details on open using react-query with `queryKey: ["quick-view", productSlug]` and `enabled: open`
    - While loading: compact skeleton (shimmer on image + text blocks)
    - Display: product image, title, price, variant selector (radio group), AnimatedCartButton
    - Inline error if no variant selected for multi-variant product (blocks `addItem`)
    - Focus trapping, `role="dialog"`, `aria-modal="true"` via Radix primitives
    - On close: return focus to `triggerRef`
    - All labels from `useI18n()` via `t()`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 8.2 Add Quick View trigger button to `ProductCard.tsx`
    - Visible on hover (desktop ≥768px) or always visible at smaller size (mobile <768px)
    - Button has `aria-label` for accessibility
    - Manage open/close state and pass `triggerRef` to QuickViewModal
    - _Requirements: 3.1, 3.8, 3.9_

  - [x] 8.3 Write property test for Quick View variant selection
    - **Property 3: Quick View addItem uses correct variant data**
    - **Validates: Requirements 3.3, 3.4**
    - Test file: `artifacts/store/src/__tests__/storefront-ux.property.test.ts`
    - Use fast-check: random products with 0-10 variants, random selected index

- [x] 9. Implement Size Guide Overlay
  - [x] 9.1 Create database migration for `size_guides` table
    - Columns: `id` (UUID), `category_id` (FK), `headers` (JSONB), `rows` (JSONB), `measurement_unit` (text), `created_at`, `updated_at`
    - _Requirements: 7.2, 7.3_

  - [x] 9.2 Create API endpoint `GET /api/size-guides/:categoryId` in `artifacts/api-server/src/routes/`
    - Query `size_guides` table by category_id
    - Accept `locale` query parameter for localized headers
    - Return `SizeGuideResponse` shape or 404 if not found
    - _Requirements: 7.2, 7.3_

  - [x] 9.3 Create `SizeGuideOverlay` component at `artifacts/store/src/components/storefront/SizeGuideOverlay.tsx`
    - Built on Radix Dialog (via `components/ui/dialog.tsx`)
    - Fetch size guide data via react-query, cached by categoryId
    - Render semantic `<table>` with `<thead>` and `<tbody>`, wrapped in an `overflow-x-auto` container so multi-column tables scroll horizontally on narrow mobile screens (320-375px)
    - Focus trap, `role="dialog"`, `aria-modal="true"`
    - On close: return focus to trigger element
    - Error state: "Size guide data is currently unavailable" + close button
    - All labels from `useI18n()` via `t()`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 9.4 Integrate Size Guide link into product page
    - Render "Size Guide" link only if size guide data exists for the product's category
    - Position adjacent to variant selector
    - If no data or fetch fails before click: link not rendered
    - _Requirements: 7.1, 7.7_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Recently Viewed Carousel Enhancement
  - [x] 11.1 Enhance `RecentlyViewed.tsx` with scroll-snap and arrow navigation
    - Add `scroll-snap-type: x mandatory` to scroll container
    - Add `scroll-snap-align: start` to each product card
    - Add `scroll-behavior: smooth` to container
    - Add left/right arrow buttons (≥768px), positioned at container edges, visible on hover
    - `scrollBy({ left: containerWidth, behavior: 'smooth' })` on arrow click
    - Hide arrows when no overflow (`scrollWidth <= clientWidth`)
    - Hide left arrow at `scrollLeft === 0`, right arrow at end position
    - Recalculate on scroll and resize events
    - `aria-label` with locale-appropriate "previous"/"next" text via `t()`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

- [x] 12. Implement skeleton loading states for remaining pages
  - [x] 12.1 Add ProductPage skeleton layout
    - Display placeholder blocks for gallery, title, price, description, variants sections
    - Each wrapped in the Shimmer component
    - Show while product page data is loading, replace with content on load (no intermediate blank)
    - _Requirements: 5.2, 5.9_

  - [x] 12.2 Add CartDrawer skeleton layout
    - Display placeholder blocks for up to 3 item rows and totals area
    - Each wrapped in the Shimmer component
    - Show while cart item details are being fetched
    - _Requirements: 5.3_

  - [x] 12.3 Verify CategoryPage skeleton uses shimmer-animated ProductSkeleton grid (8 cards default)
    - Ensure existing category loading state uses the refactored ProductSkeleton with Shimmer
    - _Requirements: 5.4_

- [x] 13. Final wiring and integration verification
  - [x] 13.1 Wire AnimatedCartButton into all add-to-cart surfaces
    - Replace existing add-to-cart buttons in: ProductCard, product page Primary CTA, StickyAddToCartBar, QuickViewModal
    - Ensure each surface calls `toastCartAdd(t, productName)` on success
    - Wire `toastOutOfStock(t, productName)` for out-of-stock attempts where applicable
    - _Requirements: 4.7, 9.1, 9.4_

  - [x] 13.2 Wire toast notifications into wishlist and coupon flows
    - Call `toastWishlist(t, productName)` when item saved to wishlist
    - Call `toastCouponApplied(t, description)` when coupon applied at checkout
    - _Requirements: 9.2, 9.3_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in the design
- Unit tests validate specific examples and edge cases
- The AnimatedCartButton is built first (task 2) because it's shared across Sticky Bar, Quick View, Product Card, and product page CTA
- Toast system is built early (task 3) because it provides feedback for cart actions across all surfaces
- Size Guide requires a DB migration and API endpoint — these are scoped minimally (read-only public endpoint, admin data entry out of scope)
- All property test sub-tasks write to the same test file (`storefront-ux.property.test.ts`) — each appends a new `describe` block

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1"] },
    { "id": 3, "tasks": ["2.3", "3.3", "4.2"] },
    { "id": 4, "tasks": ["4.3", "4.4", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1", "9.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4", "11.1"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 10, "tasks": ["13.1"] },
    { "id": 11, "tasks": ["13.2"] }
  ]
}
```
