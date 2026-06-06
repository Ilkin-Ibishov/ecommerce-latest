# Admin Improvements — Master Task List

> Generated from: `docs/tasks/admin-dashboard.md`  
> Each item links to a detailed implementation plan in this folder.

---

## Priority Legend
- **P0** — Blocking / production-broken. Fix immediately.
- **P1** — High value, next sprint.
- **P2** — Medium value, sprint after.
- **P3** — Polish / low urgency.

---

## All Tasks

| # | Priority | Task | Effort | Plan File | Status |
|---|----------|------|--------|-----------|--------|
| 1 | P0 | [WhatsApp notifications — env vars + retry endpoint](./01-whatsapp-notifications.md) | 1h | 01 | ✅ (code done; add ULTRAMSG env vars in Vercel dashboard) |
| 2 | P0 | [Orders — search by customer name/phone](./02-orders-search.md) | 2h | 02 | ✅ Done |
| 3 | P1 | [Dashboard — low stock alert panel](./03-dashboard-low-stock.md) | 3h | 03 | ✅ Done |
| 4 | P1 | [Dashboard — missing KPIs (customers, cancellation rate, coupon usage)](./04-dashboard-kpis.md) | 3h | 04 | ✅ Done |
| 5 | P1 | [Products — pagination + search/filter](./05-products-pagination-search.md) | 4h | 05 | ✅ Done |
| 6 | P1 | [Dashboard — date range selector](./06-dashboard-date-range.md) | 4h | 06 | ✅ Done |
| 7 | P2 | [Orders — CSV export](./07-orders-csv-export.md) | 3h | 07 | ✅ Done |
| 8 | P2 | [Orders — admin notes + print/invoice view](./08-orders-notes-invoice.md) | 4h | 08 | ✅ Done |
| 9 | P2 | [Products — bulk operations (toggle flags, delete)](./09-products-bulk-ops.md) | 4h | 09 | ✅ Done |
| 10 | P2 | [Products — stock adjustment + duplicate product](./10-products-stock-duplicate.md) | 3h | 10 | ✅ Done |
| 11 | P2 | [Categories — subcategory management](./11-categories-subcategories.md) | 4h | 11 | ✅ Done |
| 12 | P2 | [Customers/Users admin page](./12-users-admin-page.md) | 6h | 12 | ✅ Done |
| 13 | P2 | [Inventory / Stock report page](./13-inventory-stock-report.md) | 3h | 13 | ✅ Done |
| 14 | P3 | [Dashboard — revenue by category chart](./14-dashboard-revenue-by-category.md) | 4h | 14 | ⬜ |
| 15 | P3 | [Mobile-responsive admin sidebar](./15-mobile-responsive-sidebar.md) | 4h | 15 | ⬜ |
| 16 | P3 | [Admin settings page](./16-admin-settings-page.md) | 6h | 16 | ⬜ |

**Total estimated effort: ~58 hours** (Task 01 reduced from 2h to 1h — templates already exist)

---

## Known Architectural Issues (fix separately)

### 1. `product_categories` vs `product_specs` for category linkage
`categories.ts` uses `product_specs` rows with `spec_key = "__category"` to link products to categories — NOT the `product_categories` join table. If products are seeded with only `product_categories` rows, they won't appear on category pages. Either:
- Migrate the category API to use `product_categories` (breaking change, requires data migration)
- Or ensure all seed/import scripts also create the `product_specs` `__category` rows

### 2. Duplicate `GET /profile/orders` route
Both `cart.ts` and `orders.ts` define `GET /profile/orders`. Since `ordersRouter` is registered first in `index.ts`, the `cart.ts` version is dead code. The two routes also return different field sets. Remove the one in `cart.ts` to avoid confusion.

### 3. Route ordering critical in Tasks 07 and 09
When implementing Tasks 07 (CSV export) and 09 (bulk operations), new routes MUST be registered BEFORE the existing `:id` wildcard routes in `admin.ts`. See each plan for specifics.

---

## Sprint Groupings

### Sprint 1 — Fix Broken Things (P0, ~4h)
- Task 1: WhatsApp env vars + templates
- Task 2: Orders search

### Sprint 2 — Dashboard & Products Core (P1, ~14h)
- Task 3: Low stock alert
- Task 4: Missing KPIs
- Task 5: Products pagination + search
- Task 6: Dashboard date range

### Sprint 3 — Orders & Products Polish (P2 batch A, ~14h)
- Task 7: Orders CSV export
- Task 8: Orders notes + invoice
- Task 9: Products bulk ops
- Task 10: Products stock adjustment + duplicate

### Sprint 4 — New Sections (P2 batch B, ~13h)
- Task 11: Categories subcategories
- Task 12: Users/customers page
- Task 13: Inventory report

### Sprint 5 — Polish & Analytics (P3, ~14h)
- Task 14: Revenue by category chart
- Task 15: Mobile sidebar
- Task 16: Settings page
