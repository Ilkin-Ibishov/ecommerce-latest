# Admin Panel Backlog

## Task 1: Fix product edit page — 3 errors preventing product data load

**Priority:** CRITICAL  
**Pages affected:** Admin Products → Edit, Admin Inventory → Edit

### Issues observed:

#### 1.1 — `product_categories` relationship not found (400 Bad Request)
- **URL:** `GET /rest/v1/products?select=*,product_translations(*),product_images(*),product_categories(category_id)&id=eq.{id}`
- **Error:** `PGRST200 — Could not find a relationship between 'products' and 'product_categories' in the schema cache`
- **Root cause:** The `product_categories` table exists in `supabase/schema.sql` with proper FK to `products(id)`, but PostgREST's schema cache doesn't see it. This means either:
  - (a) The table was never migrated to the production Supabase instance, OR
  - (b) The schema cache needs a reload (Supabase dashboard → Settings → API → Reload schema)
- **Fix:** Verify the table exists in production. If not, run the migration. If it does, reload the PostgREST schema cache. As a code-level resilience fix, make the `ProductFormPage.tsx` query gracefully handle the case where `product_categories` join fails (catch error, fetch categories separately).

#### 1.2 — Product images route returns 404
- **URL:** `GET /api/admin/products/{id}/images`
- **Error:** 404 Not Found
- **Root cause:** The `product-images.ts` route uses a `productExists()` helper that queries the `products` table. If the product doesn't exist in the DB, it returns 404. However, the more likely cause is that the **API server deployed to Railway hasn't been redeployed** with the new `product-images.ts` route file. The code was just pushed to `main` but Railway may need a rebuild.
- **Fix:** Verify the Railway deployment includes the latest code. If the route is there but still 404, investigate whether the product ID is valid.

#### 1.3 — Order notifications endpoint 500
- **URL:** `GET /api/admin/orders/{id}/notifications`
- **Error:** 500 Internal Server Error
- **Root cause:** Likely a missing table or column that the notifications query references. Needs server-side log investigation.
- **Fix:** Check Railway deploy logs for the stack trace. Fix the underlying query/table issue.

### Files involved:
- `artifacts/store/src/pages/admin/ProductFormPage.tsx` (line 50 — the Supabase query)
- `artifacts/api-server/src/routes/product-images.ts` (productExists helper)
- `artifacts/api-server/src/routes/admin.ts` (notifications endpoint)

---

## Task 2: Inventory page UX & business improvements

**Priority:** P1–P4 (phased)  
**Page:** Admin → Inventory (`artifacts/store/src/pages/admin/InventoryPage.tsx`)

### Current state:
- Summary cards (out-of-stock, low stock, healthy) ✓
- Filter tabs with counts ✓
- Inline stock editing via StockCell ✓
- Row highlighting for critical items ✓
- Total inventory value in footer ✓

### Missing capabilities (prioritized):

#### P1 — Quick wins (low effort, high impact)
- **Search bar** — Debounced text search across product name and SKU (same pattern as orders page)
- **Column sorting** — Clickable column headers to sort by name, price, stock, value (toggle asc/desc)
- **SKU column** — Add SKU to the table between Product and Brand

#### P2 — Medium effort, high value
- **Bulk stock update** — Checkbox selection + action bar to set/increment stock for multiple items at once ("Shipment received" workflow)
- **CSV export** — Export filtered inventory list to CSV with all columns
- **Category filter** — Dropdown to filter by product category

#### P3 — Nice-to-have
- **Configurable low-stock threshold** — Per-product or global setting instead of hardcoded `<10`
- **Stock change indicators** — Show recent stock changes (↑/↓ arrows with delta)

#### P4 — Future enhancements
- **Stock audit log** — History of who changed stock, when, and by how much
- **Sales velocity** — Average units sold per day/week to predict stockout dates
- **Dead stock detection** — Flag items with stock > 0 but zero sales in 30+ days
- **Reorder suggestions** — Based on velocity and current stock, suggest reorder quantities

### Files involved:
- `artifacts/store/src/pages/admin/InventoryPage.tsx`
- `artifacts/store/src/components/admin/StockCell.tsx`
- `artifacts/api-server/src/routes/admin.ts` (stock endpoints)


---

## Task 3: Products page UX & business improvements

**Priority:** P1–P4 (phased)  
**Page:** Admin → Products (`artifacts/store/src/pages/admin/ProductsPage.tsx`)

### Current state (what works):
- Pagination (25/page) with URL state ✓
- Search by slug with 350ms debounce ✓
- Flag filter dropdown (featured, sale, deal, low_stock, out_of_stock) ✓
- Bulk selection + bulk actions (set/unset featured, set/unset sale, delete) ✓
- Inline stock editing via StockCell ✓
- Duplicate product action ✓
- Image preview (first image by sort_order) ✓
- Columns: Product (image+name), Slug, Brand, Price, Stock, Flags, Actions ✓

### Missing capabilities (prioritized):

#### P1 — High impact, lower effort
- **Search by product name** — Currently `ilike("slug", ...)` only; should search across `product_translations.title` OR `slug` OR `brand`. This is the #1 usability issue
- **Column sorting** — Clickable headers to sort by name, price, stock, created_at (toggle asc/desc). Currently fixed to `sort_order`

#### P2 — Medium effort, high value
- **Category column + category filter** — Show which categories each product belongs to; add category dropdown filter alongside the flag dropdown
- **Bulk price update** — Select products → "Apply % discount" or "Set sale price" action in bulk bar
- **SKU column** — Fetch and display SKU (add to Supabase query select, add column)
- **Created/Updated date column** — Show when products were added/last modified; enable date sort

#### P3 — Nice-to-have
- **Inline price editing** — Same pattern as StockCell but for price field
- **Product status (draft/active/archived)** — Lifecycle management; currently all products are implicitly "active"
- **CSV import/export** — Bulk catalog management for larger operations
- **Image count badge** — Small number overlay on the product thumbnail showing how many images it has

#### P4 — Future enhancements
- **Sales count per product** — Aggregate from order_items; show lifetime units sold
- **Cross-page bulk select** — "Select all 152 products" option for mass operations beyond current page
- **Price change history** — Audit trail for price modifications
- **AI-assisted product descriptions** — Generate missing translations from existing ones

### Key technical note:
The search-by-name issue requires either:
(a) Server-side search endpoint (like orders page uses trigram indexes), OR
(b) Using a PostgREST `or` filter with `product_translations` text search (complex with nested relations)

Recommended approach: Add a `search_text` generated column on `products` that concatenates slug + brand + az title, then ilike on that.

### Files involved:
- `artifacts/store/src/pages/admin/ProductsPage.tsx`
- `artifacts/store/src/components/admin/StockCell.tsx` (pattern for inline PriceCell)
- `artifacts/api-server/src/routes/admin.ts` (bulk endpoints)


---

## Consolidation Note: Tasks 2 & 3 share components

Tasks 2 (Inventory) and 3 (Products) should be implemented together as a **single spec** since they share overlapping needs. Here's the shared component plan:

### Shared reusable components to create in `components/admin/`:

| Component | Used by | Purpose |
|-----------|---------|---------|
| `SortableHeader.tsx` | Products, Inventory | Clickable column header with asc/desc arrow indicator |
| `SearchInput.tsx` | Products, Inventory | Debounced search input with icon + clear button (already exists on Products but hardcoded inline) |
| `CategoryFilter.tsx` | Products, Inventory | Dropdown for filtering by category |
| `StockCell.tsx` | Products, Inventory | Already shared ✓ |
| `PriceCell.tsx` | Products, (Inventory) | Inline editable price (same pattern as StockCell) |
| `CSVExportButton.tsx` | Products, Inventory | Export current filtered view to CSV |
| `BulkActionBar.tsx` | Products, (Inventory) | Already exists on Products, extract + generalize for both pages |

### Shared backend work:

| Endpoint/Feature | Used by | Purpose |
|------------------|---------|---------|
| Product full-text search | Products, Inventory | `search_text` generated column or server-side search endpoint |
| Category filter query | Products, Inventory | Same Supabase join/filter logic |
| SKU in select | Products, Inventory | Add to the query `select(...)` |

### Implementation strategy:
1. **Phase 1 — Shared primitives:** Create `SortableHeader`, extract `SearchInput`, create `CategoryFilter`
2. **Phase 2 — Backend:** Add `search_text` column, update queries to include SKU + categories
3. **Phase 3 — Inventory page:** Add search, sorting, SKU column, category filter, CSV export
4. **Phase 4 — Products page:** Switch search to full-text, add sorting, add category column/filter, add SKU column
5. **Phase 5 — Bonus:** Inline price editing, bulk price update, image count badge

This avoids duplicating 5+ components and ensures consistent UX across both pages.


---

## Task 4: Bugs found during admin panel testing (Playwright + code review)

**Priority:** Mixed (CRITICAL to LOW)  
**Tested via:** Playwright MCP browser session + source code analysis

---

### Bug 4.1 — Product images blocked by CORB/ORB (Unsplash URLs)
**Severity:** HIGH  
**Pages:** Products list, Inventory, Dashboard (Low Stock), Product Edit  
**Symptom:** All product images using Unsplash URLs fail with `ERR_BLOCKED_BY_ORB` (Cross-Origin Read Blocking). Images show as broken/empty in the admin panel.  
**Root cause:** Unsplash URLs with `w=600&q=80&auto=format&fit=crop` query params trigger ORB in Chromium. The images are being loaded as `<img>` tags which normally bypass CORB, but the response may be returning with incorrect MIME type headers from Unsplash CDN.  
**Impact:** Admin can't see any product thumbnails in the Products table, Inventory table, or Dashboard.  
**Fix options:**
1. Route all product images through `wsrv.nl` proxy (already implemented for storefront ProductCard — should apply same pattern in admin)
2. Replace Unsplash demo images with properly-hosted images (Supabase Storage)

---

### Bug 4.2 — Product edit page completely empty (400 on product_categories)
**Severity:** CRITICAL  
**Pages:** Products → Edit, Inventory → Edit  
**Symptom:** Editing any product shows a blank form with no data populated.  
**Network:** `GET /rest/v1/products?select=*,product_translations(*),product_images(*),product_categories(category_id)` → 400  
**Error:** `PGRST200 — Could not find a relationship between 'products' and 'product_categories'`  
**Root cause:** The `product_categories` table exists in `supabase/schema.sql` but was never migrated to the production Supabase database. PostgREST schema cache doesn't know about it.  
**Fix:**
1. Run the migration to create `product_categories` table in production
2. Reload PostgREST schema cache (Supabase dashboard → Settings → API → Reload schema)
3. As code resilience: catch the error and fetch categories separately, or remove `product_categories` from the join if not needed

---

### Bug 4.3 — Product images API returns 404
**Severity:** HIGH  
**Pages:** Product Edit (ProductImagePanel)  
**Symptom:** `GET /api/admin/products/:id/images` returns 404  
**Root cause:** The Railway-deployed API server hasn't been redeployed with the new `product-images.ts` route. The Vercel deployment has the latest code, but the Railway backend (which serves `/api/*`) may be stale.  
**Fix:** Verify Railway has auto-deployed from `main`. If not, trigger a manual redeploy.

---

### Bug 4.4 — Missing PWA icon (icon-192.png)
**Severity:** LOW  
**Pages:** All pages  
**Console warning:** `Error while trying to use the following icon from the Manifest: https://ecommerce-latest-api-server.vercel.app/icon-192.png (Download error or resource isn't a valid image)`  
**Fix:** Add a valid `icon-192.png` to the `public/` folder, or update the manifest to remove the icon reference.

---

### Bug 4.5 — Order notifications endpoint 500 error
**Severity:** MEDIUM  
**Pages:** Order Detail page  
**Symptom:** `GET /api/admin/orders/:id/notifications` returns 500  
**Root cause:** Likely the `notification_queue` table or related table doesn't exist in production, or a column is missing.  
**Fix:** Check Railway server logs for the stack trace. Ensure the notifications table exists in production DB.

---

### Bug 4.6 — Dashboard: Unsplash images in Low Stock section and Top Products fail
**Severity:** MEDIUM  
**Pages:** Dashboard  
**Symptom:** Product thumbnails in "Low Stock Alert" and "Top Products" sections show as broken images.  
**Root cause:** Same as Bug 4.1 — Unsplash URLs blocked by ORB.  
**Fix:** Same as Bug 4.1.

---

## Task 5: UX/Design issues found during admin panel analysis

**Priority:** LOW to MEDIUM (quality-of-life)

---

### UX 5.1 — Product edit form shows empty even on error
**Severity:** MEDIUM  
**Page:** Product Edit  
**Issue:** When the Supabase query fails (400), the form renders with empty fields. There's no error message shown to the user. The admin doesn't know why the product data isn't loading.  
**Fix:** Add error handling in the `useEffect` — if `productRes.error` exists, show an error banner like "Failed to load product data. Please try again."

---

### UX 5.2 — No "last updated" timestamp on product edit
**Severity:** LOW  
**Page:** Product Edit  
**Issue:** Admin can't see when a product was last modified. Useful for audit trail.  
**Fix:** Display `updated_at` timestamp in the form header.

---

### UX 5.3 — No delete confirmation feedback
**Severity:** LOW  
**Pages:** Products, Categories, Coupons, Comments  
**Issue:** `window.confirm()` is used for delete confirmations. This is functional but not polished — no custom modal, no undo option. Accidental deletes are irreversible.  
**Fix:** Replace `window.confirm()` with a custom confirmation dialog component (or at minimum, add a toast "Product deleted" with undo for 5 seconds).

---

### UX 5.4 — Coupons page has no pagination
**Severity:** LOW  
**Page:** Coupons  
**Issue:** All coupons are loaded at once with no pagination. For small catalogs this is fine, but won't scale.  
**Fix:** Add pagination if coupon count exceeds 50.

---

### UX 5.5 — Categories page has no search
**Severity:** LOW  
**Page:** Categories  
**Issue:** No way to search/filter categories. With 11 categories it's manageable, but if the catalog grows it becomes harder to find what you need.  

---

### UX 5.6 — Comments page lacks bulk approve
**Severity:** LOW  
**Page:** Comments  
**Issue:** Each comment must be approved individually. No "approve all" or select + bulk approve.  

---

### UX 5.7 — Audit log has no filtering by action type or date range
**Severity:** LOW  
**Page:** Audit Log  
**Issue:** Can only paginate through entries. No way to filter by action type (create_product, update_order_status, etc.) or date range.  

---

### UX 5.8 — Dashboard revenue chart Y-axis values overlap at "2550₼" and "3400₼"
**Severity:** LOW  
**Page:** Dashboard  
**Issue:** The Y-axis formatter concatenates number and ₼ without a space, and at certain values the labels overlap or look cramped. E.g., "2550₼" vs "2550 ₼".  
**Fix:** Add a space before the currency symbol in the axis formatter.

---

### UX 5.9 — ~~Admin sidebar doesn't highlight current page~~ FALSE POSITIVE
**Status:** NOT A BUG — sidebar already has active state logic (`bg-primary/20 text-primary font-medium`). Verified in `AdminLayout.tsx` line 138-145.
