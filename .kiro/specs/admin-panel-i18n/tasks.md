# Implementation Plan: Admin Panel i18n

## Overview

Extend the existing storefront i18n infrastructure to cover all admin panel pages and shared components. The implementation adds `Admin.*` namespace keys to the three locale files (az, ru, en), integrates `I18nProvider` into `AdminLayout` with localStorage-based locale management, adds a `LocaleSwitcher` component, and replaces all hardcoded English strings across 16+ admin pages and shared admin components with `t()` calls.

## Tasks

- [x] 1. Add Admin namespace to locale message files
  - [x] 1.1 Add Admin.Nav and Admin.Layout keys to all three locale files (en.ts, az.ts, ru.ts)
    - Add `Admin.Nav` sub-namespace with keys: dashboard, products, inventory, orders, customers, coupons, banners, categories, comments, audit, pages, settings
    - Add `Admin.Layout` sub-namespace with keys: adminPanel, signOut, signInWithPhone, firstTimeSetup, returnToStore, adminAccessRequired, signInDescription, loading, mobileAdmin
    - Add translations for all three locales with non-empty values
    - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3, 8.1_

  - [x] 1.2 Add Admin.Common keys to all three locale files
    - Add `Admin.Common` sub-namespace with keys: confirm, cancel, delete, save, search, export, prev, next, pageOf, selected, noResults, allCategories
    - Include interpolation placeholders: `{page}`, `{total}`, `{count}`
    - Add translations for all three locales
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 7.2, 8.1_

  - [x] 1.3 Add Admin.Dashboard keys to all three locale files
    - Add `Admin.Dashboard` sub-namespace with keys for: page title, revenue/orders KPI labels, "Top Products", "Recent Orders", date preset labels (today, 7d, 30d, all), table headers, empty states, alert text
    - _Requirements: 5.1, 7.2, 8.1_

  - [x] 1.4 Add Admin.Orders and Admin.OrderDetail keys to all three locale files
    - Add `Admin.Orders` sub-namespace: page title, table column headers (order ID, customer, date, status, total), status labels (pending, processing, shipped, delivered, cancelled, phone_verified, courier_assigned, refused_at_delivery), action buttons, empty state
    - Add `Admin.OrderDetail` sub-namespace: section headings, field labels, status labels, action buttons
    - _Requirements: 5.2, 5.14, 7.2, 8.1_

  - [x] 1.5 Add Admin.Products and Admin.ProductForm keys to all three locale files
    - Add `Admin.Products` sub-namespace: page title, table column headers, action buttons, filter labels, empty state, bulk action labels
    - Add `Admin.ProductForm` sub-namespace: all form field labels, section headings, validation error messages, action buttons
    - _Requirements: 5.3, 5.15, 7.2, 8.1_

  - [x] 1.6 Add Admin.Categories, Admin.Coupons, Admin.Banners keys to all three locale files
    - Add `Admin.Categories` sub-namespace: page title, action labels, form field labels, empty state
    - Add `Admin.Coupons` sub-namespace: page title, form field labels, table/card labels, action buttons
    - Add `Admin.Banners` sub-namespace: page title, form labels, action buttons, empty state
    - _Requirements: 5.4, 5.5, 5.6, 7.2, 8.1_

  - [x] 1.7 Add Admin.Comments, Admin.Audit, Admin.Users keys to all three locale files
    - Add `Admin.Comments` sub-namespace: page title, status labels, action buttons, empty state
    - Add `Admin.Audit` sub-namespace: page title, table column headers, filter labels
    - Add `Admin.Users` sub-namespace: page title, table column headers, action labels
    - _Requirements: 5.7, 5.8, 5.9, 7.2, 8.1_

  - [x] 1.8 Add Admin.Settings, Admin.Pages, Admin.PageEditor, Admin.Inventory keys to all three locale files
    - Add `Admin.Settings` sub-namespace: page title, section headings, form labels, action buttons
    - Add `Admin.Pages` sub-namespace: page title, table columns, action buttons, status indicators, empty state
    - Add `Admin.PageEditor` sub-namespace: form field labels, action buttons, status indicators
    - Add `Admin.Inventory` sub-namespace: page title, table column headers, stock-related labels
    - _Requirements: 5.10, 5.11, 5.12, 5.13, 7.2, 8.1_

  - [x] 1.9 Add Admin.BulkBar and Admin.BulkPriceModal keys to all three locale files
    - Add `Admin.BulkBar` sub-namespace: selection count text (`{count} selected`), action labels (setFeatured, unsetFeatured, setOnSale, unsetOnSale, bulkPrice, delete)
    - Add `Admin.BulkPriceModal` sub-namespace: modal title, form labels (percentageDiscount, fixedPrice), placeholders, progress text, action buttons (cancel, apply, updating)
    - _Requirements: 6.6, 6.7, 7.2, 8.1_

- [x] 2. Integrate I18nProvider into AdminLayout with locale management
  - [x] 2.1 Add localStorage-based locale state to AdminLayout
    - Add `adminLocale` state initialized from `localStorage.getItem("admin-locale")` with validation against `["az", "ru", "en"]` and fallback to `"en"`
    - Add `useEffect` to persist `"en"` fallback when stored value is invalid/missing
    - Wrap layout children with `<I18nProvider locale={adminLocale}>`
    - Handle `try/catch` for localStorage unavailability (private browsing)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.4_

  - [x] 2.2 Create LocaleSwitcher component
    - Create `artifacts/store/src/components/admin/LocaleSwitcher.tsx`
    - Render 3 buttons in fixed order: AZ, RU, EN
    - Active button gets `bg-primary text-primary-foreground` styling
    - Inactive buttons get `text-muted-foreground hover:bg-muted`
    - Add `aria-label` with full language name for each button (e.g., "Switch to Azerbaijani")
    - Add `role="group"` with `aria-label="Language selection"` on container
    - Keyboard accessible: focusable via Tab, activatable via Enter/Space
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

  - [x] 2.3 Wire LocaleSwitcher into AdminLayout sidebar
    - Place LocaleSwitcher below navigation links and above sign-out action
    - On locale change: `localStorage.setItem("admin-locale", newLocale)` + `setAdminLocale(newLocale)`
    - State change triggers I18nProvider re-render without page reload
    - _Requirements: 2.1, 3.1, 3.3_

  - [x] 2.4 Replace all hardcoded strings in AdminLayout with t() calls
    - Replace sidebar nav labels with `t("Admin.Nav.dashboard")`, `t("Admin.Nav.products")`, etc.
    - Replace layout strings: "Admin Panel", "Sign Out", "Sign In with Phone", "First-time Setup", "Return to Store", "Admin Access Required", sign-in description paragraph, "Loading...", mobile "Admin" header
    - Verify zero hardcoded user-facing strings remain
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 9.1_

- [x] 3. Translate shared admin components
  - [x] 3.1 Add useI18n() to Pagination component
    - Import `useI18n` and call `t("Admin.Common.prev")`, `t("Admin.Common.next")`, `t("Admin.Common.pageOf")` with `{page}` / `{total}` replacement
    - Remove hardcoded "← Prev", "Next →", "Page X of Y" strings
    - _Requirements: 6.2_

  - [x] 3.2 Add useI18n() to BulkBar component
    - Import `useI18n` and replace all hardcoded action labels with `t("Admin.BulkBar.*")` calls
    - Replace selection count text with `t("Admin.Common.selected")` + `{count}` replacement
    - _Requirements: 6.6_

  - [x] 3.3 Add useI18n() to BulkPriceModal component
    - Import `useI18n` and replace hardcoded title, form labels, placeholders, progress text, and action buttons with `t("Admin.BulkPriceModal.*")` calls
    - _Requirements: 6.7_

  - [x] 3.4 Add useI18n() to CSVExportButton and CategoryFilter components
    - CSVExportButton: replace hardcoded "Export CSV" with `t("Admin.Common.export")`
    - CategoryFilter: replace hardcoded "All categories" with `t("Admin.Common.allCategories")`
    - _Requirements: 6.4, 6.8_

  - [x] 3.5 Update parent components to pass translated strings to ConfirmDialog, SearchInput, TableEmptyState
    - Update parents calling ConfirmDialog to pass `t("Admin.Common.confirm")` / `t("Admin.Common.cancel")` as props
    - Update parents calling SearchInput to pass `t("Admin.Common.search")` as placeholder
    - Update parents calling TableEmptyState to pass `t("Admin.Common.noResults")` as message
    - _Requirements: 6.1, 6.3, 6.5_

- [x] 4. Checkpoint - Verify shared components and layout
  - Ensure all tests pass (`pnpm exec vitest --run --project store-unit`), ask the user if questions arise.
  - Run `pnpm run typecheck` to verify no type errors with new Admin keys.

- [x] 5. Translate admin pages (batch 1: high-traffic pages)
  - [x] 5.1 Translate DashboardPage
    - Replace all hardcoded strings with `t("Admin.Dashboard.*")` calls
    - Covers: headings, KPI labels, date preset labels, table headers, empty states, alert text
    - _Requirements: 5.1, 9.1_

  - [x] 5.2 Translate OrdersPage
    - Replace all hardcoded strings with `t("Admin.Orders.*")` calls
    - Covers: page title, table column headers, status labels, action buttons, empty state
    - _Requirements: 5.2, 9.1_

  - [x] 5.3 Translate ProductsPage
    - Replace all hardcoded strings with `t("Admin.Products.*")` calls
    - Covers: page title, table column headers, action buttons, filter labels, empty state
    - _Requirements: 5.3, 9.1_

  - [x] 5.4 Translate OrderDetailPage
    - Replace all hardcoded strings with `t("Admin.OrderDetail.*")` calls
    - Covers: section headings, field labels, status labels, action buttons
    - _Requirements: 5.14, 9.1_

  - [x] 5.5 Translate ProductFormPage
    - Replace all hardcoded strings with `t("Admin.ProductForm.*")` calls
    - Covers: all form field labels, section headings, validation error messages, action buttons
    - _Requirements: 5.15, 9.1_

- [x] 6. Translate admin pages (batch 2: remaining pages)
  - [x] 6.1 Translate CategoriesPage and CouponsPage
    - CategoriesPage: replace hardcoded strings with `t("Admin.Categories.*")` calls
    - CouponsPage: replace hardcoded strings with `t("Admin.Coupons.*")` calls
    - _Requirements: 5.4, 5.5, 9.1_

  - [x] 6.2 Translate BannersPage and CommentsPage
    - BannersPage: replace hardcoded strings with `t("Admin.Banners.*")` calls
    - CommentsPage: replace hardcoded strings with `t("Admin.Comments.*")` calls
    - _Requirements: 5.6, 5.7, 9.1_

  - [x] 6.3 Translate AuditPage and UsersPage
    - AuditPage: replace hardcoded strings with `t("Admin.Audit.*")` calls
    - UsersPage: replace hardcoded strings with `t("Admin.Users.*")` calls
    - _Requirements: 5.8, 5.9, 9.1_

  - [x] 6.4 Translate SettingsPage and InventoryPage
    - SettingsPage: replace hardcoded strings with `t("Admin.Settings.*")` calls
    - InventoryPage: replace hardcoded strings with `t("Admin.Inventory.*")` calls
    - _Requirements: 5.10, 5.13, 9.1_

  - [x] 6.5 Translate PagesPage and PageEditorPage
    - PagesPage: replace hardcoded strings with `t("Admin.Pages.*")` calls
    - PageEditorPage: replace hardcoded strings with `t("Admin.PageEditor.*")` calls
    - _Requirements: 5.11, 5.12, 9.1_

  - [x] 6.6 Translate AdminSetupPage
    - Replace hardcoded strings in AdminSetupPage with appropriate `t()` calls
    - Add any needed keys to `Admin.Layout` or a dedicated `Admin.Setup` sub-namespace
    - _Requirements: 9.1_

- [x] 7. Checkpoint - Full page translation verification
  - Ensure all tests pass (`pnpm exec vitest --run --project store-unit`), ask the user if questions arise.
  - Run `pnpm run typecheck` to confirm no type errors.
  - Run `pnpm run build` to confirm production build succeeds.

- [x] 7.5 Deduplicate Admin translation keys — consolidate into Admin.Common
  - Scan all `Admin.*` sub-namespaces across en.ts, az.ts, ru.ts for repeated values (same string in multiple page namespaces)
  - Move generic/repeated strings to `Admin.Common`: save, saving, cancel, delete, edit, loading, retry, back, error, networkError, confirm, noResults, notFound, actions, title-like patterns that are identical
  - Update all `t()` call sites in components/pages to reference the consolidated `Admin.Common.*` keys
  - Remove the now-unused page-specific keys from all 3 locale files
  - Run `pnpm run typecheck` to verify no broken references
  - Run `pnpm exec vitest --run --project store-unit` to ensure tests still pass
  - _Requirements: 7.1, 7.2, 8.1_

- [ ] 8. Write property-based and unit tests
  - [x] 8.1 Write property test for invalid locale fallback (Property 1)
    - **Property 1: Invalid locale fallback**
    - Generate random non-locale strings (including empty, whitespace, numbers, unicode) via fast-check
    - For each generated string, set as `admin-locale` in mock localStorage
    - Verify the admin locale resolver returns `"en"` and persists `"en"` back
    - **Validates: Requirements 1.3, 2.3**

  - [x] 8.2 Write property test for locale selection round-trip (Property 2)
    - **Property 2: Locale selection round-trip**
    - Generate random valid locale from `["az", "ru", "en"]` via `fc.constantFrom`
    - Simulate locale switcher selection, verify localStorage persistence and state update
    - **Validates: Requirements 2.1, 3.3**

  - [ ]* 8.3 Write property test for translation key structure consistency (Property 5)
    - **Property 5: Translation key structure consistency**
    - Extract all dot-separated key paths from all 3 locale files
    - Verify set equality: every key in one locale exists in all locales
    - Verify all values are non-empty, non-whitespace-only strings
    - **Validates: Requirements 7.3, 8.1, 8.3**

  - [ ]* 8.4 Write property test for Admin namespace depth constraint (Property 6)
    - **Property 6: Admin namespace depth constraint**
    - For all keys under `Admin.*`, verify dot-separated segment count ≤ 3
    - **Validates: Requirements 7.2**

  - [ ]* 8.5 Write property test for missing key fallback identity (Property 7)
    - **Property 7: Missing key fallback identity**
    - Generate random strings that are NOT valid message keys via fast-check
    - Pass to `t()` (or `getT()`) function, verify identity return (input === output)
    - **Validates: Requirements 8.2**

  - [ ]* 8.6 Write property test for active locale visual distinction (Property 4)
    - **Property 4: Active locale visual distinction**
    - For each locale in `["az", "ru", "en"]`, verify the active button has `bg-primary text-primary-foreground` class and inactive buttons do NOT
    - **Validates: Requirements 3.4**

  - [ ]* 8.7 Write property test for LocaleSwitcher keyboard accessibility (Property 9)
    - **Property 9: Locale switcher keyboard accessibility**
    - Verify each locale button is focusable, activatable via Enter/Space
    - Verify each button has `aria-label` with full language name
    - **Validates: Requirements 3.5**

  - [ ]* 8.8 Write unit tests for AdminLayout locale initialization
    - Test: default "en" when localStorage empty
    - Test: reads valid stored locale ("az", "ru")
    - Test: falls back to "en" for invalid stored value
    - Test: graceful fallback when localStorage unavailable
    - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.4_

  - [ ]* 8.9 Write unit tests for LocaleSwitcher component
    - Test: renders 3 buttons in AZ/RU/EN order
    - Test: active locale button has contrasting styling
    - Test: clicking a locale calls onChange with correct value
    - Test: aria-labels contain full language names
    - _Requirements: 3.2, 3.4, 3.5_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Run full test suite: `pnpm exec vitest --run --project store-unit`
  - Run typecheck: `pnpm run typecheck`
  - Run build: `pnpm run build`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `i18n-consistency` test will automatically validate Admin.* keys once added (no changes needed to the test itself)
- NotificationCenterPage is already translated — no task needed for it
- String interpolation uses `{placeholder}` pattern with `.replace()` at call site (existing convention)
- All shared components that render their own text (Pagination, BulkBar, BulkPriceModal, CSVExportButton, CategoryFilter) call `useI18n()` directly
- Components receiving text as props (ConfirmDialog, SearchInput, TableEmptyState) get translated strings from parents

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 4.5, "tasks": ["7.5"], "description": "Deduplicate repeated keys into Admin.Common" },
    { "id": 5, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9"] }
  ]
}
```
