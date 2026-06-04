# Admin Dashboard — Current State & Remaining Work

> Last updated: June 2026  
> Route prefix: `/admin/*`  
> Layout: `artifacts/store/src/pages/admin/AdminLayout.tsx`  
> API route: `artifacts/api-server/src/routes/admin.ts`

---

## ✅ What Is Already Fully Built

The admin panel is substantially complete. Every section below is live and functional.

### Authentication & Access Control
- Admin-only gate in `AdminLayout.tsx` — checks `users.role = 'admin'` via Supabase
- Phone OTP login embedded directly in the admin gate (same `LoginModal` as storefront)
- First-time setup flow via `/admin/setup` with bootstrap endpoint (`/api/bootstrap/status`)
- Sign-out button clears Supabase session and redirects to storefront
- All API routes protected by `requireAdmin()` middleware — returns 403 for non-admins

### Dashboard (`/admin`)
**File:** `DashboardPage.tsx`

| Widget | Status | Detail |
|--------|--------|--------|
| Revenue KPI (this month vs last) | ✅ Done | With MoM % delta and trend arrow |
| Orders KPI (this month vs last) | ✅ Done | Shows pending count as sub-label |
| Average Order Value KPI | ✅ Done | With MoM % delta |
| Pending Orders KPI | ✅ Done | With MoM % delta |
| Revenue line chart (last 30 days) | ✅ Done | Recharts `LineChart`, daily granularity, custom tooltip |
| Orders by Status donut chart | ✅ Done | Recharts `PieChart`, color-coded per status |
| Top 5 Products This Month | ✅ Done | By revenue, with product image, units sold, link to edit |
| Recent Orders table (last 10) | ✅ Done | ID, customer, status badge, total, date; links to order detail |
| Loading skeletons | ✅ Done | Pulse animations on all widgets while loading |

**Data sources:** Direct Supabase queries from the frontend (no API intermediary needed for read-only analytics).

### Orders (`/admin/orders`, `/admin/orders/:id`)
**Files:** `OrdersPage.tsx`, `OrderDetailPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| Orders list with pagination (30/page) | ✅ Done | |
| Filter by status (tab buttons) | ✅ Done | All 7 statuses |
| Order detail page | ✅ Done | Customer info, items with line totals, discount/coupon display |
| Status update dropdown | ✅ Done | Any valid transition selectable |
| Auto-restock on cancel | ✅ Done | Calls `increment_stock` RPC or fallback conditional update |
| WhatsApp notification log | ✅ Done | Collapsible panel, shows type/status/attempts/errors |
| WhatsApp test message sender | ✅ Done | Input + send button within order detail |
| Audit log on status change | ✅ Done | Records old→new status |

### Products (`/admin/products`, `/admin/products/new`, `/admin/products/:id/edit`)
**Files:** `ProductsPage.tsx`, `ProductFormPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| Product list table | ✅ Done | Image, title, slug, price, stock (red if < 5), flags |
| Create product | ✅ Done | Full form |
| Edit product | ✅ Done | Pre-fills all fields from DB |
| Delete product | ✅ Done | With confirm dialog |
| Multi-language translations | ✅ Done | AZ / RU / EN tabs |
| Image upload | ✅ Done | Auto-compressed to WebP via `browser-image-compression`, stored in Supabase Storage |
| Technical specs | ✅ Done | Key/value pairs with add/remove/sort |
| Category assignment | ✅ Done | Checkbox multi-select |
| Flags | ✅ Done | Featured, On Sale, Deal of Day |
| SKU, brand, original price, sort order | ✅ Done | |
| Audit log on create/update/delete | ✅ Done | |

### Coupons (`/admin/coupons`)
**File:** `CouponsPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| List all coupons | ✅ Done | Code, discount, used/max, expiry, status |
| Create coupon | ✅ Done | Inline form; percentage or fixed; min order, max uses, expiry |
| Edit coupon | ✅ Done | Same inline form, pre-filled |
| Delete coupon | ✅ Done | |
| Toggle active/inactive | ✅ Done | One-click toggle button |

### Banners (`/admin/banners`)
**File:** `BannersPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| List banners with preview image | ✅ Done | |
| Create banner | ✅ Done | Modal form: title, subtitle, image upload/URL, CTA text, CTA URL, sort order |
| Edit banner | ✅ Done | |
| Delete banner | ✅ Done | |
| Toggle active | ✅ Done | Eye/EyeOff icon |
| Image upload | ✅ Done | Compressed to WebP, max 1920px |

### Categories (`/admin/categories`)
**File:** `CategoriesPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| List categories (root only) | ✅ Done | Name, slug, icon |
| Create category | ✅ Done | Slug + icon URL + translations for AZ/RU/EN |
| Edit category | ✅ Done | |
| Delete category | ✅ Done | |

### Comments / Reviews (`/admin/comments`)
**File:** `CommentsPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| List all comments (pending + approved) | ✅ Done | Shows user, product, date, content |
| Approve comment | ✅ Done | |
| Unapprove comment | ✅ Done | |
| Delete comment | ✅ Done | |

### Audit Log (`/admin/audit`)
**File:** `AuditPage.tsx`

| Feature | Status | Detail |
|---------|--------|--------|
| Paginated audit log (50/page) | ✅ Done | Time, admin name, action (color-coded), entity + ID |

---

## ❌ What Is Missing / Incomplete

### 1. Dashboard — Missing Widgets (High Priority)

The existing dashboard is good but missing several high-value analytics widgets:

| Widget | Why Needed | Effort |
|--------|-----------|--------|
| **Customer count** (new this month vs last) | Know if customer base is growing | Low |
| **Conversion funnel** (sessions → orders, if trackable) | N/A without analytics integration | High |
| **Revenue by category** (bar chart) | Identify which categories drive sales | Medium |
| **Low stock alert panel** | Products with stock < threshold — actionable | Low |
| **Coupon usage summary** | Which coupons are being used most | Low |
| **Cancelled orders rate** | Key operational metric | Low |

### 2. Dashboard — Date Range Selector (Medium Priority)

Currently the KPIs are hardcoded to "this month vs last month". There's no way to:
- View last 7 days / last 90 days / custom range
- Export data

**Files to change:** `DashboardPage.tsx`

### 3. Orders — Missing Features (High Priority)

| Feature | Detail |
|---------|--------|
| **Search orders** by customer name or phone | Currently no search input on orders list |
| **Bulk status update** | Select multiple orders and update status together |
| **Export orders to CSV** | Download for accounting/logistics |
| **Order notes from admin** | Admin can add internal notes to an order |
| **Print/invoice view** | Printable order summary page |

**Files to change:** `OrdersPage.tsx`, `OrderDetailPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

### 4. Products — Missing Features (Medium Priority)

| Feature | Detail |
|---------|--------|
| **Search/filter products** by name or SKU | Currently no filter; all 152+ products load at once — will become slow |
| **Pagination** on products list | Products list loads everything; needs pagination |
| **Bulk operations** | Bulk toggle featured/sale, bulk delete |
| **Stock adjustment tool** | Quick increment/decrement stock without opening full edit form |
| **Drag-and-drop sort order** | Sort order is a number field, not visual drag |
| **CSV/Excel import** | Bulk product import for onboarding large catalogs |
| **Duplicate product** | Clone an existing product as starting point |

**Files to change:** `ProductsPage.tsx`, `ProductFormPage.tsx`, `admin.ts`

### 5. Categories — Missing Features (Low Priority)

| Feature | Detail |
|---------|--------|
| **Subcategory management** | UI only shows root categories. Subcategories (`parent_id`) exist in DB but can't be created/edited via admin |
| **Drag-and-drop reorder** | No sort order for categories currently |

**File to change:** `CategoriesPage.tsx`, `admin.ts`

### 6. WhatsApp — Partially Wired (High Priority)

The infrastructure exists but the messages don't fire correctly in production:

| Issue | Detail |
|-------|--------|
| **Missing Azerbaijani templates** | `whatsapp.ts` sends placeholder text, not real Azerbaijani order confirmation messages |
| **`ULTRAMSG_INSTANCE` and `ULTRAMSG_TOKEN` not set in Vercel** | Env vars need to be added to Vercel production environment |
| **No delivery status notifications** | When status changes to `shipped` or `delivered`, no WhatsApp message is sent with tracking context |
| **No failed notification retry UI** | Admin can see failed notifications but can't manually retry them |

**Files to change:** `artifacts/api-server/src/lib/whatsapp.ts`, `admin.ts` (add retry endpoint)  
**Vercel env vars needed:** `ULTRAMSG_INSTANCE`, `ULTRAMSG_TOKEN`

### 7. No Users/Customers Section (Medium Priority)

There's no admin page for viewing registered customers:
- Customer list (phone, name, order count, registration date)
- Customer order history
- Ability to change a user's role to/from admin

**New file needed:** `artifacts/store/src/pages/admin/UsersPage.tsx`  
**New API route needed:** `GET /admin/users`, `PATCH /admin/users/:id/role`

### 8. No Inventory / Stock Report (Medium Priority)

No page showing:
- Products sorted by stock level
- Out-of-stock products
- Products with stock < X (configurable threshold)

Currently stock is visible in the product list but not queryable as a standalone view.

### 9. No Settings Page (Low Priority)

No admin UI for:
- Store name / branding
- Free delivery threshold (currently hardcoded as 100 AZN in frontend)
- Contact information
- Feature flags (enable/disable sections)

### 10. Mobile Responsiveness (Medium Priority)

Admin panel uses a fixed `w-56` sidebar that doesn't collapse on mobile. On screens < 768px:
- Sidebar overlaps content
- Tables are horizontally scrollable but have no mobile-optimized view

---

## 🔧 Quick Wins (Can be done in < 1 day each)

1. **Low stock panel on dashboard** — Query products where `stock < 10`, display as alert list
2. **Orders search** — Add a text input on OrdersPage that filters by `customer_name` or `customer_phone`
3. **Customer count KPI on dashboard** — Simple `count` query on `users` table
4. **Products pagination** — Add `.range()` to the products query and pagination buttons
5. **Cancelled orders KPI on dashboard** — Add to existing status breakdown data already fetched

---

## 📋 Implementation Order (Recommended)

| Priority | Task | Effort |
|----------|------|--------|
| P0 | Set WhatsApp env vars in Vercel + write Azerbaijani templates | 2h |
| P0 | Add orders search by customer name/phone | 2h |
| P1 | Add low stock alert panel to dashboard | 3h |
| P1 | Products list pagination + search | 4h |
| P1 | Add missing dashboard KPIs (customers, cancellation rate) | 3h |
| P1 | Dashboard date range picker | 4h |
| P2 | Subcategory management in admin | 4h |
| P2 | Customers/users admin page | 6h |
| P2 | Orders CSV export | 3h |
| P3 | Mobile-responsive sidebar (hamburger menu) | 4h |
| P3 | Admin settings page (store config) | 6h |

---

## 🗂 File Map

| Page | Route | Frontend File | API Route |
|------|-------|--------------|-----------|
| Dashboard | `/admin` | `DashboardPage.tsx` | Direct Supabase reads |
| Orders list | `/admin/orders` | `OrdersPage.tsx` | Direct Supabase reads |
| Order detail | `/admin/orders/:id` | `OrderDetailPage.tsx` | `PATCH /admin/orders/:id/status` |
| Products list | `/admin/products` | `ProductsPage.tsx` | `DELETE /admin/products/:id` |
| Product form | `/admin/products/new` or `/:id/edit` | `ProductFormPage.tsx` | `POST/PATCH /admin/products` |
| Coupons | `/admin/coupons` | `CouponsPage.tsx` | `POST/PATCH/DELETE /admin/coupons` |
| Banners | `/admin/banners` | `BannersPage.tsx` | `POST/PATCH/DELETE /admin/banners` |
| Categories | `/admin/categories` | `CategoriesPage.tsx` | `POST/PATCH/DELETE /admin/categories` |
| Comments | `/admin/comments` | `CommentsPage.tsx` | `PATCH/DELETE /admin/comments/:id` |
| Audit log | `/admin/audit` | `AuditPage.tsx` | Direct Supabase reads |
| Setup | `/admin/setup` | `AdminSetupPage.tsx` | `POST /bootstrap` |
