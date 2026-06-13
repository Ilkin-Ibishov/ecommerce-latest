# Implementation Plan: Product Image Management

## Overview

Transform the product image system from single-image external URLs into a multi-image management platform with intelligent sourcing (search, barcode, paste, upload), wsrv.nl proxy optimization, admin reorder/delete UI, and an interactive storefront gallery. Implementation proceeds database-first, then backend services, then API routes, then frontend components — each phase building on the previous.

## Tasks

- [x] 1. Database migration and schema setup
  - [x] 1.1 Add `source` column and unique index to `product_images` table
    - Create a Supabase migration that adds `source TEXT NOT NULL DEFAULT 'paste' CHECK (source IN ('search','barcode','paste','upload'))` to `product_images`
    - Create unique index `idx_product_images_url` on `(product_id, url)`
    - Ensure backward compatibility: existing rows get default `'paste'`
    - _Requirements: 12.1, Data Invariants_

- [ ] 2. Image proxy utility (frontend)
  - [x] 2.1 Create `image-proxy.ts` module in `artifacts/store/src/lib/`
    - Implement `getProxyUrl(rawUrl: string, preset: ImagePreset): string`
    - Implement `extractOriginalUrl(proxyUrl: string): string | null`
    - Export `PRESETS` record with thumbnail (300×300, q80), gallery (1000×1000, q85), lightbox (1600×1600, q90)
    - Ensure proper URL encoding for URLs with query parameters and special characters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [-] 2.2 Write property tests for image proxy (Property 1: Proxy URL format correctness)
    - **Property 1: Proxy URL format correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - Create `artifacts/store/tests/image-proxy.property.test.ts`
    - Generate random valid HTTPS URLs × all presets, assert output contains correct base URL, encoded source, and matching w/h/q/output params

  - [-] 2.3 Write property tests for image proxy (Property 2: Round-trip encoding)
    - **Property 2: Proxy URL round-trip encoding**
    - **Validates: Requirements 1.4, 1.5**
    - In same test file, generate URLs with query params, fragments, unicode, special chars
    - Assert `extractOriginalUrl(getProxyUrl(url, preset)) === url` for all generated URLs

  - [-] 2.4 Write property test for proxy URL idempotence (Property 10)
    - **Property 10: Proxy URL idempotence**
    - **Validates: Requirements 1.3**
    - Assert `getProxyUrl(url, preset) === getProxyUrl(url, preset)` for random inputs

  - [-] 2.5 Write unit tests for image proxy edge cases
    - Test specific preset outputs for known URLs
    - Test `extractOriginalUrl` with malformed/missing params
    - Test URLs with encoded characters, long URLs, missing protocol
    - _Requirements: 1.3, 1.4, 1.5_

- [x] 3. Checkpoint — Image proxy utility complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Backend services (API server)
  - [-] 4.1 Create `image-search.ts` service in `artifacts/api-server/src/lib/`
    - Implement `searchImages(query: string): Promise<string[]>` using `scrape-google-images`
    - Add 3-second cooldown logic (in-memory timestamp)
    - Return up to 20 deduplicated HTTPS URLs
    - _Requirements: 3.1, 9 (dedup from Property 9)_

  - [x] 4.2 Create `barcode-lookup.ts` service in `artifacts/api-server/src/lib/`
    - Implement `validateBarcode(barcode: string): boolean` supporting EAN-8, EAN-13, UPC-A, UPC-E with check digit validation
    - Implement `lookupBarcode(barcode: string): Promise<BarcodeResult | null>` calling UPCitemdb.com free API
    - Return `{ title, images }` or null if not found
    - _Requirements: 4.1, 4.2, 4.4, 4.6_

  - [x] 4.3 Create `rate-limiter.ts` service in `artifacts/api-server/src/lib/`
    - Implement `checkDailyLimit(service: string, maxPerDay: number): Promise<boolean>`
    - Implement `incrementDailyCount(service: string): Promise<void>`
    - Use Supabase table or in-memory counter with daily reset
    - _Requirements: 4.5_

  - [x] 4.4 Extend `asset-uploader.ts` with `product` category
    - Add `"product"` to `AssetCategory` type
    - Route product uploads to `products/` folder in `site-assets` bucket
    - Keep existing 5 MB limit and MIME validation (jpeg, png, webp, avif)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 5. API routes for product images
  - [x] 5.1 Create `product-images.ts` route file in `artifacts/api-server/src/routes/`
    - Implement `GET /api/admin/products/:id/images` — list all images sorted by sort_order
    - Implement `POST /api/admin/products/:id/images` — add image from URL (body: `{ url, alt_text?, source }`)
    - Enforce max 5 images constraint, HTTPS-only URLs, duplicate URL rejection (409)
    - Use `requireAdmin()` middleware, async handlers, `req.log` for logging
    - _Requirements: 7.1, 12.1, Data Invariants_

  - [x] 5.2 Implement search and barcode API routes
    - Implement `POST /api/admin/products/:id/images/search` — validate query length (2–200 chars), call `searchImages()`, respect cooldown
    - Implement `POST /api/admin/products/:id/images/barcode` — validate barcode format, check rate limit, call `lookupBarcode()`
    - Return proper error codes: 400 for validation, 429 for rate limit, 502 for service errors
    - _Requirements: 3.1, 3.4, 3.5, 4.1, 4.4, 4.5, 4.6_

  - [x] 5.3 Implement upload API route
    - Implement `POST /api/admin/products/:id/images/upload` — multipart form data via asset-uploader
    - Store returned Supabase CDN URL as product_image with `source='upload'`
    - Enforce max images constraint before upload
    - Return proper error codes: 413 for file too large, 415 for unsupported type
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

  - [x] 5.4 Implement reorder and delete API routes
    - Implement `PATCH /api/admin/products/:id/images/reorder` — accept `{ image_ids: string[] }`, validate all IDs belong to product, update sort_order sequentially
    - Implement `DELETE /api/admin/products/:id/images/:imageId` — delete record, reassign sort_order to maintain contiguity, delete storage file if source='upload'
    - _Requirements: 8.1, 8.2, 8.4, 9.1, 9.2, 9.3, 9.4_

  - [x] 5.5 Register product-images routes in the Express app
    - Import and mount routes in the main app router
    - Ensure all routes are behind `requireAdmin()` middleware
    - _Requirements: All API routes_

- [x] 6. Checkpoint — Backend API complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Property-based tests for backend logic
  - [x] 7.1 Write property test for max images constraint (Property 3)
    - **Property 3: Maximum images constraint**
    - **Validates: Requirements 7.1, 3.3, 7.4**
    - Create `artifacts/api-server/tests/product-images.property.test.ts`
    - Generate random current counts (0–5) × random add counts (1–10)
    - Assert: added = min(K, 5 - N), total never exceeds 5

  - [x] 7.2 Write property test for barcode validation (Property 4)
    - **Property 4: Barcode validation**
    - **Validates: Requirements 4.6**
    - Create `artifacts/api-server/tests/barcode-validation.property.test.ts`
    - Generate random strings, valid EANs (8/13 digit with correct check digit), valid UPCs (A/E)
    - Assert: validator returns true iff format and check digit are correct

  - [x] 7.3 Write property test for sort order contiguity (Property 5)
    - **Property 5: Sort order contiguity invariant**
    - **Validates: Requirements 8.2, 8.4, 9.3**
    - In `product-images.property.test.ts`
    - Generate random operation sequences (add/delete/reorder) and verify sort_order is always [0, 1, ..., n-1]

  - [x] 7.4 Write property test for source tracking (Property 6)
    - **Property 6: Source tracking completeness**
    - **Validates: Requirements 12.1**
    - In `product-images.property.test.ts`
    - Generate random image creation with random sources, verify source field is always one of the 4 valid values

  - [x] 7.5 Write property test for duplicate URL rejection (Property 7)
    - **Property 7: Duplicate URL rejection**
    - **Validates: Data Invariant (unique URL per product)**
    - In `product-images.property.test.ts`
    - Generate random URLs, attempt to add same URL twice, verify second attempt fails and image list is unchanged

  - [x] 7.6 Write property test for search result deduplication (Property 9)
    - **Property 9: Search result deduplication**
    - **Validates: Requirements 3.1**
    - In `artifacts/api-server/tests/image-search.property.test.ts`
    - Generate arrays of URLs with potential duplicates, verify search service output has no duplicates

- [x] 8. Checkpoint — Property tests complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Frontend: Update ProductCard to use proxy URLs
  - [x] 9.1 Update `ProductCard` component to render images through `getProxyUrl()`
    - Import `getProxyUrl` from `lib/image-proxy`
    - Use `thumbnail` preset for catalog card images
    - Add `onError` handler to fall back to raw URL if proxy fails
    - Display "No image" placeholder when product has no images
    - _Requirements: 11.1, 11.2, 11.3, 2.1, 2.2_

- [x] 10. Frontend: ProductGallery component
  - [x] 10.1 Create `ProductGallery.tsx` in `artifacts/store/src/components/storefront/`
    - Render primary image (sort_order 0) as large main image with `gallery` preset
    - Render thumbnail strip below main image for multi-image products
    - Implement click-to-select thumbnail behavior
    - Implement left/right swipe navigation on mobile (touch events)
    - Implement lightbox on desktop click with `lightbox` preset
    - Lazy-load non-visible images
    - Hide navigation controls for single-image products
    - Add `onError` fallback to raw URL for proxy failures
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 2.3_

- [x] 11. Frontend: AdminImagePanel and tab components
  - [x] 11.1 Create `ImageCandidateGrid.tsx` — selectable grid for search/barcode results
    - Display image previews in a responsive grid
    - Support multi-select with visual feedback (checkmark overlay)
    - Respect remaining slot limit — disable selection beyond available slots
    - Grey out/disable URLs already added to product
    - _Requirements: 3.2, 3.3, 4.2, 7.4_

  - [x] 11.2 Create `ImageSearchTab.tsx` — text search input and candidate grid
    - Text input with submit button
    - Call `POST /api/admin/products/:id/images/search`
    - Display results in `ImageCandidateGrid`
    - Show loading state, empty state ("No images found"), and error state with retry
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 11.3 Create `ImageBarcodeTab.tsx` — barcode input, validation, and results
    - Input field with barcode format validation (client-side)
    - Call `POST /api/admin/products/:id/images/barcode`
    - Display results in `ImageCandidateGrid`
    - Show specific error for invalid format, rate limit exceeded, and no results
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 11.4 Create `ImagePasteTab.tsx` — URL input with preview and confirm
    - Input field for pasting URL
    - Load and display preview image on paste
    - Show error if URL doesn't resolve to a valid image
    - Confirm button to add as product image with `source='paste'`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 11.5 Create `ImageUploadTab.tsx` — drag-and-drop file upload zone
    - Drag-and-drop area with file picker fallback
    - Show file preview before upload
    - Display upload progress and error states
    - Accept jpeg, png, webp, avif only; reject files > 5 MB with clear message
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 11.6 Create `ImageGrid.tsx` — reorderable grid with drag-and-drop, delete, and source badges
    - Display current product images in grid with sort_order sequence
    - Implement drag-and-drop reordering (call `PATCH .../reorder` on drop)
    - Delete button with confirmation modal
    - Source badge indicator on each image
    - _Requirements: 8.1, 8.2, 8.3, 9.1, 9.2, 12.2_

  - [x] 11.7 Create `ProductImagePanel.tsx` — main orchestrator with tabs and image count
    - Tab navigation: Search, Barcode, Paste, Upload
    - Display current image count and remaining slots (e.g., "3/5 images")
    - Disable all image-adding controls when product has 5 images
    - Integrate `ImageGrid` for existing images display/reorder
    - Wire tab selection results to `POST .../images` endpoint
    - _Requirements: 7.2, 7.3, 7.4_

- [x] 12. Integration with existing admin product form
  - [x] 12.1 Integrate `ProductImagePanel` into admin product edit page
    - Replace or augment existing single-image URL field with `ProductImagePanel`
    - Pass product ID and current images to the panel
    - Ensure panel refreshes image list after add/delete/reorder operations
    - _Requirements: All admin UI requirements_

- [x] 13. Final checkpoint — Full feature verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: typecheck passes (`pnpm run typecheck`)
  - Verify: build succeeds (`pnpm run build`)
  - Verify: all property tests pass
  - Verify: admin image panel renders correctly with all tabs functional
  - Verify: storefront gallery displays images with proxy URLs

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All API routes use Express 5 async handlers, `req.log`, and `requireAdmin()` middleware
- Frontend uses React 19, Tailwind v4, and wouter for routing
- The pnpm monorepo has `@workspace/store` and `@workspace/api-server` packages
- fast-check is used for property-based testing, vitest as the test runner

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5", "4.1", "4.2", "4.3", "4.4"] },
    { "id": 2, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["5.5", "7.1", "7.2", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 4, "tasks": ["9.1", "10.1", "11.1"] },
    { "id": 5, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 6, "tasks": ["11.7"] },
    { "id": 7, "tasks": ["12.1"] }
  ]
}
```
