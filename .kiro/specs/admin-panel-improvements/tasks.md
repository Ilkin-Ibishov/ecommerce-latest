# Implementation Plan: Admin Panel Improvements

## Overview

Phased implementation of admin panel improvements: database migrations and critical fixes first, then image proxy integration and error handling, followed by shared reusable components, and finally page-level upgrades that consume those components. The architecture prioritizes shared components in `artifacts/store/src/components/admin/` to avoid duplication across Products, Inventory, and other admin pages.

## Tasks

- [x] 1. Database migrations and critical fixes
  - [x] 1.1 Create `product_categories` table migration
    - Create `supabase/migrations/ensure_product_categories.sql`
    - Use `CREATE TABLE IF NOT EXISTS` for idempotency
    - Define `product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE`
    - Define `category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE`
    - Define composite `PRIMARY KEY (product_id, category_id)`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Create `search_text` column with trigger-based population
    - Create `supabase/migrations/add_search_text_column.sql`
    - Add `search_text TEXT` column to `products` table (NOT a generated column)
    - Create `CREATE EXTENSION IF NOT EXISTS pg_trgm`
    - Create a function `fn_update_search_text()` that concatenates `slug || ' ' || COALESCE(brand, '')` and fetches the `az` title from `product_translations` to append
    - Create triggers on `products` (INSERT/UPDATE) and `product_translations` (INSERT/UPDATE where `lang_code = 'az'`) that call the function
    - Add backfill: `UPDATE products SET search_text = ...` using a subquery joining `product_translations`
    - Create GIN trigram index: `CREATE INDEX idx_products_search_text_trgm ON products USING gin (search_text gin_trgm_ops)`
    - _Requirements: 13.1, 13.2_

  - [x] 1.3 Add PWA icon placeholder
    - Create `artifacts/store/public/icon-192.png` — a valid 192×192 PNG file (can be a simple colored square or the store logo)
    - Ensure the manifest.json references this path correctly
    - _Requirements: 3.1, 3.2_

  - [x] 1.4 Fix notifications endpoint error handling
    - Modify `artifacts/api-server/src/routes/admin.ts` — wrap the `GET /admin/orders/:id/notifications` handler in try/catch
    - If the notifications table/column doesn't exist, return `200` with an empty array instead of crashing with 500
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 2. Image proxy integration and error handling
  - [x] 2.1 Add image proxy to ProductsPage thumbnails
    - Modify `artifacts/store/src/lib/image-proxy.ts` — add idempotence guard: if `rawUrl` already contains `wsrv.nl`, return it unchanged. This prevents double-proxying at the source.
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Import `getProxyUrl` from `@/lib/image-proxy`
    - Replace raw image URLs with `getProxyUrl(url, "thumbnail")` for product thumbnails
    - Add `onError` fallback to raw URL
    - _Requirements: 5.1, 5.5_

  - [x] 2.2 Add image proxy to InventoryPage thumbnails
    - Modify `artifacts/store/src/pages/admin/InventoryPage.tsx`
    - Import `getProxyUrl` from `@/lib/image-proxy`
    - Apply `getProxyUrl(url, "thumbnail")` to thumbnails, add `onError` fallback to raw URL
    - No idempotence check needed here (handled inside `getProxyUrl` from task 2.1)
    - _Requirements: 5.2, 5.5_

  - [x] 2.3 Add image proxy to DashboardPage images
    - Modify `artifacts/store/src/pages/admin/DashboardPage.tsx`
    - Apply `getProxyUrl` to Low Stock section and Top Products section thumbnails
    - Add `onError` fallback to raw URL
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 2.4 Add error banner to ProductFormPage
    - Modify `artifacts/store/src/pages/admin/ProductFormPage.tsx`
    - Add error state tracking for the Supabase product query
    - Render an error banner with AlertTriangle icon, error message, and Retry button when query fails
    - Hide loading state and show error banner instead of empty form
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 3. Checkpoint — Verify migrations and proxy fixes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Shared admin components
  - [x] 4.1 Create SortableHeader component
    - Create `artifacts/store/src/components/admin/SortableHeader.tsx`
    - Implement as a `<th>` element with click handler
    - Props: `label`, `sortKey`, `currentSort`, `currentDir`, `onSort`
    - Show arrow indicator (↑/↓) when active; neutral state when inactive
    - Toggle direction on re-click; reset to ascending on new column click
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 4.2 Create SearchInput component
    - Create `artifacts/store/src/components/admin/SearchInput.tsx`
    - Controlled input with internal debounce timer (default 300ms)
    - Props: `placeholder`, `value`, `onChange`, `debounceMs`
    - Show Search icon on left, clear (X) button on right when non-empty
    - Clear button immediately invokes `onChange("")`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.3 Create CategoryFilter component
    - Create `artifacts/store/src/components/admin/CategoryFilter.tsx`
    - Fetch categories from Supabase on mount (with `category_translations` for `az` locale)
    - Render `<select>` with "All categories" default + fetched options
    - Props: `value`, `onFilter`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 4.4 Create ConfirmDialog component
    - Create `artifacts/store/src/components/admin/ConfirmDialog.tsx`
    - Render via `createPortal` to `document.body` as a fixed overlay
    - Props: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `destructive`, `onConfirm`, `onCancel`
    - Handle Escape key to cancel, backdrop click to cancel
    - Destructive mode: red confirm button styling
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 4.5 Create CSVExportButton component
    - Create `artifacts/store/src/components/admin/CSVExportButton.tsx`
    - Generic component using `CSVColumn<T>` interface with key (accessor or function) and header
    - Generate CSV via `Blob` + `URL.createObjectURL` + anchor click
    - Filename format: `{name}-YYYY-MM-DD.csv`
    - Export `escapeCSV()` helper that handles commas, quotes, newlines per RFC 4180
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 4.6 Create PriceCell component
    - Create `artifacts/store/src/components/admin/PriceCell.tsx`
    - Follow existing `StockCell` pattern: click to edit, blur/Enter to save, Escape to cancel
    - Props: `productId`, `initialPrice`, `onSaved`
    - Display: `{price.toFixed(2)} AZN` in read mode, `<input type="number">` in edit mode
    - Validation: reject negative, NaN, or unchanged values — revert without API call
    - Save via `PATCH /api/admin/products/:id` with `{ price: newPrice }`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 5. Products page upgrade
  - [x] 5.1 Add full-text search to ProductsPage
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Replace existing inline search input with the shared `SearchInput` component
    - Change the Supabase query filter from `ilike("slug", ...)` to `ilike("search_text", ...)`
    - Persist search query in URL param `q`
    - Show "No products found" message when search returns empty
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 5.2 Add column sorting to ProductsPage
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Replace static `<th>` headers with `SortableHeader` components for Name, Price, Stock, SKU columns
    - Read sort state from URL params `sort` and `dir`
    - Apply server-side sorting via Supabase `.order(sortField, { ascending })` for price, stock, sku, sort_order
    - For "name" sort: sort client-side after fetching (since title comes from product_translations join)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 5.3 Add SKU and Category columns to ProductsPage
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Add `sku` to the Supabase select query
    - Add `product_categories(category_id, categories(id, category_translations(lang_code, title)))` to the query
    - Render SKU column (show dash if null)
    - Render Category column (show category name from `az` translation)
    - Add `CategoryFilter` component to the toolbar alongside existing flag filter
    - Filter products by selected category using `.in("id", categoryProductIds)` or client-side filter
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 5.4 Add bulk price update to ProductsPage
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Add "Bulk Price" button to the existing bulk action bar (shown when products selected)
    - Create a modal/dialog with radio options: "Percentage discount" and "Set fixed price"
    - On confirm: iterate selected products, call `PATCH /api/admin/products/:id` with new price
    - Show progress indicator during update
    - Track and report failures: "X of Y updates failed"
    - Refresh table data on completion
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 5.5 Replace `window.confirm` with ConfirmDialog in ProductsPage
    - Modify `artifacts/store/src/pages/admin/ProductsPage.tsx`
    - Add `ConfirmDialog` state management (open, title, message, onConfirm)
    - Replace the delete confirmation `window.confirm()` call with the `ConfirmDialog` component
    - Use `destructive={true}` for delete actions
    - _Requirements: 10.3, 10.4, 10.5_

- [x] 6. Checkpoint — Verify Products page
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Inventory page upgrade
  - [x] 7.1 Add search and sorting to InventoryPage
    - Modify `artifacts/store/src/pages/admin/InventoryPage.tsx`
    - Add `SearchInput` component for filtering by name/slug/brand (client-side filter)
    - Replace static `<th>` headers with `SortableHeader` components for Name, Price, Stock, Value
    - Implement client-side sorting with `Array.sort()` (all data already in memory)
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 7.2 Add SKU column and CategoryFilter to InventoryPage
    - Modify `artifacts/store/src/pages/admin/InventoryPage.tsx`
    - Add SKU to the Supabase select and render as a table column
    - Add `CategoryFilter` component to the toolbar
    - Filter displayed products by selected category (client-side)
    - _Requirements: 17.4, 17.5_

  - [x] 7.3 Add CSV export to InventoryPage
    - Modify `artifacts/store/src/pages/admin/InventoryPage.tsx`
    - Add `CSVExportButton` with columns: Product Name, SKU, Brand, Category, Price (AZN), Stock, Value (AZN)
    - Pass currently filtered dataset to the component
    - Filename: `inventory-export`
    - _Requirements: 18.1, 18.2, 18.3_

- [x] 8. Minor page upgrades
  - [x] 8.1 Add filters to AuditPage
    - Modify `artifacts/store/src/pages/admin/AuditPage.tsx`
    - Add action type dropdown (populated from distinct `audit_log.action` values)
    - Add date range inputs (from/to)
    - Apply filters as AND conditions on the Supabase query: `.eq("action", ...)` and `.gte/.lte("created_at", ...)`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x] 8.2 Add bulk approve to CommentsPage
    - Modify `artifacts/store/src/pages/admin/CommentsPage.tsx`
    - Add checkboxes for each pending comment
    - Add "Approve Selected" button (visible only when ≥1 comment selected)
    - On click: iterate selected IDs, call `PATCH /api/admin/comments/:id` with `{ approved: true }`
    - Update UI state on success without page reload
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 8.3 Replace `window.confirm` in CategoriesPage and CommentsPage
    - Modify `artifacts/store/src/pages/admin/CategoriesPage.tsx` — replace delete `window.confirm()` with `ConfirmDialog`
    - Modify `artifacts/store/src/pages/admin/CommentsPage.tsx` — replace delete `window.confirm()` with `ConfirmDialog`
    - Modify `artifacts/store/src/components/admin/ImageGrid.tsx` — replace delete `window.confirm()` with `ConfirmDialog`
    - Use `destructive={true}` for all delete confirmations
    - _Requirements: 10.3, 10.4, 10.5_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The `search_text` column uses a trigger-based approach (NOT a generated column) because PostgreSQL generated columns cannot reference other tables via subqueries
- Products page "name" sorting is done client-side since the title lives in `product_translations` join; server-side sorting is used for price, stock, sku, sort_order
- PriceCell reuses the existing `PATCH /api/admin/products/:id` endpoint already in `admin.ts`
- ConfirmDialog replaces `window.confirm()` in 4 locations: ProductsPage, CategoriesPage, CommentsPage, ImageGrid

### Architecture Decisions

1. **Proxy idempotence in `getProxyUrl()`** — The `getProxyUrl()` function itself should check if the URL is already proxied (contains `wsrv.nl`) and return it unchanged. This eliminates the need for callers to do the check and follows the Single Responsibility Principle. Update `image-proxy.ts` in task 2.1.

2. **SearchInput ownership model** — SearchInput is a CONTROLLED component. The parent owns the canonical value; SearchInput manages only the internal debounce timer. The `value` prop sets the input; `onChange` fires after the debounce delay. The clear button calls `onChange("")` immediately (no debounce for intentional clear). This prevents state sync issues between URL params and the input.

3. **Bulk price update — known limitation** — The sequential PATCH approach works for typical admin selections (5-25 products) but is O(n) network calls. For future scale, a `PATCH /admin/products/bulk-price` endpoint should batch all updates in a single DB transaction. This is noted as a P4 future enhancement.

4. **Wave 0 must deploy before wave 3** — Task 5.3 (category columns) depends on the `product_categories` table existing in production (task 1.1). The wave ordering enforces this, but if deploying incrementally, ensure migration 1.1 runs on production before the Products page upgrade code goes live.

5. **No global error boundary** — Individual pages handle their own errors (error banner, empty states). A global React ErrorBoundary is out of scope for this spec but would be a good addition for a future resilience spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["8.1", "8.2", "8.3"] }
  ]
}
```
