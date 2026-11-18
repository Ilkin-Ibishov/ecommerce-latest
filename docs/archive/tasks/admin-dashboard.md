# Admin Dashboard — Current State (All Features Complete)

> Last updated: June 8, 2026  
> Route prefix: `/admin/*`  
> Layout: `artifacts/store/src/pages/admin/AdminLayout.tsx`  
> API route: `artifacts/api-server/src/routes/admin.ts`  
> Status: **All 16 improvement tasks completed** (Sprints 1–5)

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

## ✅ All Previously Missing Features — Now Complete

All items from the original audit have been implemented across 5 sprints. See `docs/tasks/admin-improvements/00-master-task-list.md` for detailed status.

### Completed in Sprint 1 (P0)
- ✅ WhatsApp notifications — env vars + retry endpoint
- ✅ Orders search by customer name/phone

### Completed in Sprint 2 (P1)
- ✅ Dashboard low stock alert panel
- ✅ Dashboard missing KPIs (customers, cancellation rate, coupon usage)
- ✅ Products pagination + search/filter
- ✅ Dashboard date range selector

### Completed in Sprint 3 (P2 batch A)
- ✅ Orders CSV export
- ✅ Orders admin notes + print/invoice view
- ✅ Products bulk operations (toggle flags, delete)
- ✅ Products stock adjustment + duplicate product

### Completed in Sprint 4 (P2 batch B)
- ✅ Categories subcategory management
- ✅ Customers/Users admin page
- ✅ Inventory / Stock report page

### Completed in Sprint 5 (P3)
- ✅ Dashboard revenue by category chart
- ✅ Mobile-responsive admin sidebar
- ✅ Admin settings page

---

## 🔮 Potential Future Enhancements

These items were not in the original audit scope but could add value:

- Drag-and-drop sort order for products and categories
- CSV/Excel product import for bulk onboarding
- Conversion funnel analytics (requires frontend event tracking)
- Advanced order filtering (date range, amount range)
- Bulk order status update (select multiple)

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
