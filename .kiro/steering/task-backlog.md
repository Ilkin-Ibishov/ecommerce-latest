---
inclusion: manual
---

# Implementation Task Backlog

Pre-planned feature implementations with detailed steps. Use these as input when creating Kiro specs.

## Ready Tasks (Fully Specified)

### 1. Admin Analytics Dashboard
**Priority:** High | **Effort:** Medium
**What:** Live KPI cards (revenue, orders, AOV), 30-day revenue chart, top products table, orders-by-status donut
**Tech:** Recharts (already installed), direct Supabase queries from frontend
**Files:** `artifacts/store/src/pages/admin/DashboardPage.tsx`

### 2. ~~Search Autocomplete~~ ✅ DONE
**Status:** Implemented and deployed. Instant suggestions with products + categories, keyboard navigation, debounced API.

### 3. SEO & Open Graph
**Priority:** High | **Effort:** Medium
**What:** Per-page meta tags, JSON-LD Product schema, OG tags for social previews, sitemap.xml, robots.txt
**Files:** All storefront pages, new API routes for sitemap/robots

### 4. WhatsApp Notifications (Azerbaijani)
**Priority:** High | **Effort:** Low (skeleton exists)
**What:** Azerbaijani message templates, enriched order confirmation, admin test endpoint, delivery status in Order Detail
**Status:** Integration skeleton fully wired (whatsapp.ts, notifications.ts, orders.ts). Missing: env vars, Azerbaijani templates, order detail enrichment.
**Provider:** UltraMsg (ultramsg.com) — env vars `ULTRAMSG_INSTANCE` + `ULTRAMSG_TOKEN`
**Files:** `whatsapp.ts`, `notifications.ts`, `orders.ts`, `admin.ts`, `OrderDetailPage.tsx`

### 5. Product Comparison Tool
**Priority:** Medium | **Effort:** Medium
**What:** Compare button on cards, floating tray (max 3), side-by-side specs table, difference highlighting
**Tech:** React context + localStorage, no new API needed
**Files:** `App.tsx`, `ProductCard.tsx`, `ProductDetail.tsx`, new `ComparePage.tsx`

### 6. ~~User Profile Enhancements~~ ✅ DONE
**Status:** Implemented. Editable name, saved default address (pre-fills checkout), order history with re-order button.

### 7. Mobile App (Expo)
**Priority:** Low (future) | **Effort:** High
**What:** React Native companion app with same API backend
**Screens:** Home, Products, Product Detail, Cart, Checkout, Profile
**Note:** Entire backend API is ready; this is frontend-only work

## Recently Completed (June 2026)

| Feature | Commit | Notes |
|---------|--------|-------|
| Search Autocomplete | `9eecf5f` | Products + categories suggestions, keyboard nav |
| Cart localStorage Validation | `c91b132` | Rejects tampered data (negative prices, invalid items) |
| Cart Quantity UX | `c91b132` | "Update Cart" for existing items instead of additive |
| Checkout Form Validation | `c91b132` | Inline error messages, phone format check |
| Categories Page i18n | `c91b132` | All strings translated (az/ru/en) |
| Coupon System | `c91b132` | Status code fix + WELCOME10/FLAT20 seeded |
| Cart Price Refresh | `c91b132` | Checkout fetches live prices, removes stale items |
| Brand Icon Fallbacks | `c91b132` | Text fallback when CDN icon fails |

## Detailed Specs

Full implementation details for each task are in:
- `docs/tasks/admin-analytics.md`
- `docs/tasks/search-autocomplete.md`
- `docs/tasks/seo-optimization.md`
- `docs/tasks/whatsapp-notifications.md`
- `docs/tasks/product-comparison.md`
- `docs/tasks/user-profile-page.md`
- `docs/tasks/mobile-app.md`
