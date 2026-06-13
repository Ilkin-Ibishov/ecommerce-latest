# Requirements Document

## Introduction

This spec covers four phases of admin panel improvements for the white-label e-commerce platform: critical hotfixes for deployment and database issues, image proxy integration and error handling, shared reusable admin components, and page-level upgrades that consume those shared components. The goal is to resolve blocking production bugs, improve image rendering reliability, reduce code duplication across admin pages, and enhance admin productivity with search, sorting, filtering, and bulk operations.

## Glossary

- **Admin_Panel**: The administrative interface accessible at `/admin/*` routes, used by store administrators to manage products, inventory, orders, and settings.
- **API_Server**: The Express 5 backend (`@workspace/api-server`) deployed on Railway/Vercel that serves `/api/*` endpoints.
- **Image_Proxy**: The `wsrv.nl`-based image optimization service accessed via `getProxyUrl()` from `lib/image-proxy.ts`.
- **Product_Categories_Table**: The `product_categories` join table linking products to categories, defined in `supabase/schema.sql`.
- **StockCell**: Existing inline-editable stock component in `components/admin/StockCell.tsx`.
- **PriceCell**: New inline-editable price component following the StockCell pattern.
- **SortableHeader**: A reusable clickable table column header component with ascending/descending sort indicators.
- **SearchInput**: A reusable debounced text search input with icon and clear button.
- **CategoryFilter**: A dropdown component for filtering records by product category.
- **ConfirmDialog**: A modal dialog component replacing native `window.confirm()` calls.
- **CSVExportButton**: A button component that exports the current filtered table data to a CSV file.
- **Full_Text_Search**: Search capability that matches against product name, slug, and brand fields rather than slug-only.
- **Supabase**: The PostgreSQL database and auth platform used for data storage and RLS.
- **Railway**: The hosting platform for the API_Server deployment.

## Requirements

### Requirement 1: Database Migration for product_categories Table

**User Story:** As an administrator, I want the product_categories table to exist in production so that product-category associations load correctly in the edit form.

#### Acceptance Criteria

1. WHEN the migration script is executed against the production Supabase instance, THE Admin_Panel SHALL have access to the `product_categories` table with foreign keys referencing both `products(id)` and `categories(id)`.
2. WHEN the product_categories table exists in production, THE Admin_Panel SHALL successfully join `product_categories(category_id)` in product queries without returning a PGRST200 error.
3. IF the migration script encounters an existing `product_categories` table, THEN THE migration script SHALL skip table creation and complete without error.

### Requirement 2: API Server Redeployment for Product-Images Routes

**User Story:** As an administrator, I want the product-images API routes to be available so that the ProductImagePanel loads image data correctly.

#### Acceptance Criteria

1. WHEN the API_Server is deployed to Railway with the latest code from `main`, THE API_Server SHALL respond to `GET /api/admin/products/:id/images` with a 200 status and the product's image list.
2. WHEN the API_Server is deployed to Railway with the latest code from `main`, THE API_Server SHALL respond to `POST /api/admin/products/:id/images` for image management operations.
3. IF the API_Server deployment fails, THEN THE deployment process SHALL report the failure with a descriptive error in Railway logs.

### Requirement 3: PWA Manifest Icon

**User Story:** As a user, I want the PWA manifest to reference a valid icon so that no console errors appear and the app can be installed correctly.

#### Acceptance Criteria

1. THE Admin_Panel SHALL include a valid `icon-192.png` file (192×192 pixels) in the public assets directory referenced by the PWA manifest.
2. WHEN the browser requests the manifest icon at the path specified in `manifest.json`, THE server SHALL return a valid PNG image with a 200 status.

### Requirement 4: Order Notifications Endpoint Fix

**User Story:** As an administrator, I want the order notifications endpoint to return data successfully so that I can view notification history for orders.

#### Acceptance Criteria

1. WHEN an administrator requests `GET /api/admin/orders/:id/notifications`, THE API_Server SHALL return a 200 status with the notification list for that order.
2. IF the notifications table or required columns do not exist in the database, THEN THE migration process SHALL create them before the endpoint is used.
3. IF no notifications exist for the given order, THEN THE API_Server SHALL return a 200 status with an empty array.

### Requirement 5: Image Proxy for Admin Image Rendering

**User Story:** As an administrator, I want all product images in the admin panel to render through the image proxy so that images are not blocked by CORB/ORB browser policies.

#### Acceptance Criteria

1. WHEN the Products table renders a product thumbnail, THE Admin_Panel SHALL pass the raw image URL through `getProxyUrl()` with the `thumbnail` preset before setting the `<img>` src attribute.
2. WHEN the Inventory table renders a product thumbnail, THE Admin_Panel SHALL pass the raw image URL through `getProxyUrl()` with the `thumbnail` preset before setting the `<img>` src attribute.
3. WHEN the Dashboard Low Stock section renders a product image, THE Admin_Panel SHALL pass the raw image URL through `getProxyUrl()` with the `thumbnail` preset.
4. WHEN the Dashboard Top Products section renders a product image, THE Admin_Panel SHALL pass the raw image URL through `getProxyUrl()` with the `thumbnail` preset.
5. IF the image URL is already a `wsrv.nl` proxy URL, THEN THE Admin_Panel SHALL use it directly without double-proxying.

### Requirement 6: Error Banner in ProductFormPage on Query Failure

**User Story:** As an administrator, I want to see a clear error message when the product edit form fails to load data so that I understand why the form is empty.

#### Acceptance Criteria

1. IF the Supabase query for product data returns an error, THEN THE Admin_Panel SHALL display a visible error banner above the form with the message describing the failure.
2. IF the Supabase query for product data returns an error, THEN THE Admin_Panel SHALL hide the loading state and show the error banner instead of an empty form.
3. WHEN the error banner is displayed, THE Admin_Panel SHALL include a retry action that re-attempts the product data fetch.

### Requirement 7: SortableHeader Component

**User Story:** As a developer, I want a reusable sortable column header component so that any admin table can add column sorting without duplicating code.

#### Acceptance Criteria

1. THE SortableHeader component SHALL accept props for column label, sort key, current sort field, current sort direction, and an `onSort` callback.
2. WHEN an administrator clicks the SortableHeader, THE component SHALL invoke the `onSort` callback with the column's sort key and toggled direction (ascending to descending, or descending to ascending).
3. WHILE the column is the active sort field, THE SortableHeader SHALL display a directional arrow indicator (up for ascending, down for descending).
4. WHILE the column is not the active sort field, THE SortableHeader SHALL display a neutral state without a directional arrow.

### Requirement 8: SearchInput Component

**User Story:** As a developer, I want a reusable debounced search input so that multiple admin pages can share the same search UX pattern.

#### Acceptance Criteria

1. THE SearchInput component SHALL accept props for placeholder text, current value, an `onChange` callback, and an optional debounce delay (defaulting to 300ms).
2. WHEN the administrator types into the SearchInput, THE component SHALL debounce the `onChange` callback by the configured delay before invoking it with the current value.
3. WHEN the search input has text, THE SearchInput SHALL display a clear button that resets the value to empty and immediately invokes `onChange` with an empty string.
4. THE SearchInput SHALL display a search icon on the left side of the input field.

### Requirement 9: CategoryFilter Component

**User Story:** As an administrator, I want to filter tables by product category so that I can focus on specific product segments.

#### Acceptance Criteria

1. THE CategoryFilter component SHALL fetch available categories from Supabase and display them in a dropdown with an "All categories" default option.
2. WHEN the administrator selects a category from the dropdown, THE CategoryFilter SHALL invoke the `onFilter` callback with the selected category ID.
3. WHEN the administrator selects the "All categories" option, THE CategoryFilter SHALL invoke the `onFilter` callback with a null value to clear the filter.
4. THE CategoryFilter SHALL display category names in the current admin locale (defaulting to Azerbaijani).

### Requirement 10: ConfirmDialog Component

**User Story:** As an administrator, I want a proper confirmation modal instead of browser `window.confirm()` so that destructive actions have a polished and accessible confirmation UX.

#### Acceptance Criteria

1. THE ConfirmDialog component SHALL accept props for title, description message, confirm button label, cancel button label, a destructive flag, and `onConfirm`/`onCancel` callbacks.
2. WHEN the ConfirmDialog is open, THE component SHALL render a modal overlay that traps focus within the dialog.
3. WHEN the administrator clicks the confirm button, THE ConfirmDialog SHALL invoke the `onConfirm` callback and close the dialog.
4. WHEN the administrator clicks the cancel button or presses Escape, THE ConfirmDialog SHALL invoke the `onCancel` callback and close the dialog without performing the action.
5. WHILE the destructive flag is true, THE ConfirmDialog SHALL style the confirm button with a destructive/red color scheme.

### Requirement 11: CSVExportButton Component

**User Story:** As an administrator, I want to export the current filtered table data to CSV so that I can analyze inventory and product data in spreadsheet tools.

#### Acceptance Criteria

1. THE CSVExportButton component SHALL accept the current filtered dataset and column configuration as props.
2. WHEN the administrator clicks the CSVExportButton, THE component SHALL generate a CSV file from the provided data with appropriate column headers.
3. WHEN the CSV file is generated, THE CSVExportButton SHALL trigger a browser download with a filename that includes the table name and current date.
4. THE CSVExportButton SHALL properly escape CSV values containing commas, quotes, or newlines.

### Requirement 12: PriceCell Component

**User Story:** As an administrator, I want to edit product prices inline in the table so that I can quickly adjust pricing without navigating to the edit form.

#### Acceptance Criteria

1. THE PriceCell component SHALL display the current price as formatted text (with AZN currency suffix) in read mode.
2. WHEN the administrator clicks the PriceCell, THE component SHALL switch to edit mode showing a number input pre-filled with the current price.
3. WHEN the administrator confirms the new price (pressing Enter or blurring the input), THE PriceCell SHALL call the `PATCH /api/admin/products/:id` endpoint with the updated price.
4. IF the new price value is negative or not a valid number, THEN THE PriceCell SHALL revert to the original price and exit edit mode without saving.
5. WHEN the administrator presses Escape in edit mode, THE PriceCell SHALL revert to the original price and exit edit mode without saving.

### Requirement 13: Products Page Full-Text Search

**User Story:** As an administrator, I want to search products by name, slug, and brand so that I can quickly find any product without knowing its exact slug.

#### Acceptance Criteria

1. WHEN the administrator types a search query on the Products page, THE Admin_Panel SHALL match products against name (from product_translations), slug, and brand fields.
2. THE Full_Text_Search SHALL support partial matching (substring search) across all three fields.
3. WHEN no products match the search query, THE Admin_Panel SHALL display a "no results" message indicating the search criteria.

### Requirement 14: Products Page Column Sorting

**User Story:** As an administrator, I want to sort the products table by different columns so that I can organize products by price, stock, or name.

#### Acceptance Criteria

1. WHEN the administrator clicks a sortable column header on the Products page, THE Admin_Panel SHALL re-sort the product list by that column in ascending order.
2. WHEN the administrator clicks the same column header again, THE Admin_Panel SHALL toggle the sort direction from ascending to descending.
3. THE Products page SHALL support sorting by product name, price, stock, and SKU columns.
4. WHEN sorting is active, THE Admin_Panel SHALL persist the sort state in the URL query parameters.

### Requirement 15: Products Page SKU and Category Columns

**User Story:** As an administrator, I want to see SKU and category information in the products table so that I can identify products and their categorization at a glance.

#### Acceptance Criteria

1. THE Products page table SHALL display an SKU column showing each product's SKU value (or a dash if null).
2. THE Products page table SHALL display a Category column showing the associated category names for each product.
3. WHEN a category filter is selected, THE Admin_Panel SHALL display only products that belong to the selected category.

### Requirement 16: Products Page Bulk Price Update

**User Story:** As an administrator, I want to update prices for multiple selected products at once so that I can efficiently run sales or adjust pricing across product groups.

#### Acceptance Criteria

1. WHEN the administrator selects multiple products and chooses the bulk price action, THE Admin_Panel SHALL display a dialog with options to set a percentage discount or an absolute price.
2. WHEN the administrator confirms the bulk price update, THE Admin_Panel SHALL send the updated prices to the API_Server for all selected products.
3. WHEN the bulk price update completes successfully, THE Admin_Panel SHALL update the displayed prices in the table without requiring a page reload.
4. IF any product in the bulk update fails, THEN THE Admin_Panel SHALL report which products failed and preserve successful updates.

### Requirement 17: Inventory Page Search, Sorting, and Filtering

**User Story:** As an administrator, I want to search, sort, and filter the inventory table so that I can efficiently manage stock across a large product catalog.

#### Acceptance Criteria

1. WHEN the administrator types a search query on the Inventory page, THE Admin_Panel SHALL filter products by name, slug, or brand matching the query.
2. WHEN the administrator clicks a sortable column header on the Inventory page, THE Admin_Panel SHALL sort the inventory list by that column with toggle between ascending and descending order.
3. THE Inventory page SHALL support sorting by product name, price, stock, and inventory value columns.
4. THE Inventory page table SHALL display an SKU column showing each product's SKU value.
5. WHEN the administrator selects a category in the CategoryFilter on the Inventory page, THE Admin_Panel SHALL display only products belonging to that category.

### Requirement 18: Inventory Page CSV Export

**User Story:** As an administrator, I want to export the filtered inventory data to CSV so that I can share stock reports and perform offline analysis.

#### Acceptance Criteria

1. WHEN the administrator clicks the CSV export button on the Inventory page, THE Admin_Panel SHALL generate a CSV file containing all currently filtered inventory rows.
2. THE exported CSV SHALL include columns for product name, SKU, brand, category, price, stock quantity, and inventory value.
3. THE exported CSV filename SHALL follow the pattern `inventory-export-YYYY-MM-DD.csv`.

### Requirement 19: Audit Log Filtering

**User Story:** As an administrator, I want to filter the audit log by action type and date range so that I can investigate specific administrative actions within a time window.

#### Acceptance Criteria

1. WHEN the administrator selects an action type filter on the Audit Log page, THE Admin_Panel SHALL display only audit entries matching the selected action type.
2. WHEN the administrator sets a date range filter on the Audit Log page, THE Admin_Panel SHALL display only audit entries with timestamps within the specified range.
3. THE Audit Log page SHALL provide a dropdown listing all distinct action types present in the log (e.g., create_product, update_order_status, delete_product).
4. WHEN both action type and date range filters are active simultaneously, THE Admin_Panel SHALL apply both filters as an AND condition.

### Requirement 20: Comments Bulk Approve

**User Story:** As an administrator, I want to approve multiple comments at once so that I can efficiently moderate user reviews.

#### Acceptance Criteria

1. THE Comments page SHALL provide checkboxes for selecting multiple pending comments.
2. WHEN the administrator selects one or more comments and clicks the bulk approve button, THE Admin_Panel SHALL send an approval request for all selected comments to the API_Server.
3. WHEN the bulk approval completes successfully, THE Admin_Panel SHALL update the status of all approved comments in the UI without requiring a page reload.
4. THE bulk approve button SHALL only be visible when at least one comment is selected.
