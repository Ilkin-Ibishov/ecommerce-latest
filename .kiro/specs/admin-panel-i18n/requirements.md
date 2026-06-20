# Requirements Document

## Introduction

This feature brings internationalization (i18n) support to the admin panel of the white-label e-commerce platform. Currently, all admin panel pages and components use hardcoded English strings. The storefront already has full i18n support via the `useI18n()` hook and `t()` function with 3 locales (az, ru, en). This feature extends the same i18n infrastructure to cover all admin panel routes (`/admin/...`), enabling admin users to operate the panel in Azerbaijani, Russian, or English.

## Glossary

- **Admin_Panel**: The set of pages and components served under `/admin/` routes, used by store administrators to manage products, orders, categories, users, and settings.
- **I18n_System**: The existing internationalization infrastructure consisting of `useI18n()` hook, `t()` function, `I18nProvider` context, and per-locale message files (`az.ts`, `ru.ts`, `en.ts`).
- **Translation_Key**: A dot-notated string (e.g., `Admin.Dashboard.title`) used with the `t()` function to retrieve a locale-specific string.
- **Message_Files**: The TypeScript modules at `lib/i18n/messages/{az,ru,en}.ts` that export locale-specific translation objects.
- **Admin_Locale_Preference**: The administrator's selected display language, persisted in browser localStorage.
- **Locale_Switcher**: A UI control allowing the admin user to switch the admin panel display language.
- **Admin_Layout**: The shared layout component (`AdminLayout.tsx`) wrapping all admin pages, containing the sidebar navigation, header, and sign-out functionality.

## Requirements

### Requirement 1: Admin Panel I18nProvider Integration

**User Story:** As an admin user, I want the admin panel to be wrapped in the I18nProvider, so that all admin pages and components have access to the translation function.

#### Acceptance Criteria

1. WHEN an admin page renders, THE Admin_Layout SHALL wrap its children inside the I18nProvider with the locale value read from the Admin_Locale_Preference in localStorage.
2. IF no Admin_Locale_Preference value exists in localStorage, THEN THE Admin_Layout SHALL pass "en" as the locale to the I18nProvider.
3. IF the Admin_Locale_Preference value in localStorage is not one of the supported locales ("az", "ru", "en"), THEN THE Admin_Layout SHALL pass "en" as the locale to the I18nProvider.
4. WHEN the Admin_Locale_Preference value in localStorage changes, THE Admin_Layout SHALL provide the updated locale to the I18nProvider so that subsequent calls to t() return translations for the new locale.

### Requirement 2: Admin Locale Persistence

**User Story:** As an admin user, I want my language preference to be remembered across sessions, so that I do not have to re-select my language each time I open the admin panel.

#### Acceptance Criteria

1. WHEN an admin user selects a locale via the Locale_Switcher, THE I18n_System SHALL persist the selected locale to localStorage under the key `admin-locale` and immediately render all Admin_Panel UI text in the selected locale without requiring a page reload.
2. WHEN the Admin_Panel loads and the localStorage key `admin-locale` contains a supported locale value ("az", "ru", or "en"), THE I18n_System SHALL render all Admin_Panel UI text in that stored locale.
3. IF the localStorage key `admin-locale` is absent, empty, or contains a value other than "az", "ru", or "en", THEN THE I18n_System SHALL fall back to "en" and persist "en" to localStorage under the key `admin-locale`.
4. IF localStorage is unavailable or unwritable, THEN THE I18n_System SHALL default to "en" for the current session without displaying an error to the user.

### Requirement 3: Admin Locale Switcher UI

**User Story:** As an admin user, I want a language switcher in the admin panel sidebar, so that I can change the display language at any time.

#### Acceptance Criteria

1. THE Admin_Layout SHALL display a Locale_Switcher control in the sidebar, positioned below the navigation links and above the sign-out action, visible without scrolling when the sidebar is open.
2. THE Locale_Switcher SHALL present all three supported locales as uppercase two-letter codes in fixed order: AZ, RU, EN.
3. WHEN the admin user selects a locale, THE Locale_Switcher SHALL update the Admin_Locale_Preference and all translated content on the page SHALL re-render in the selected locale without a full page reload.
4. THE Locale_Switcher SHALL apply a visually distinct style (contrasting background and foreground color) to the currently active locale button, differentiating it from inactive locale buttons.
5. THE Locale_Switcher SHALL be keyboard-accessible, with each locale option focusable via Tab and activatable via Enter or Space, and each button SHALL include an `aria-label` indicating the locale name.

### Requirement 4: Admin Layout and Navigation Translations

**User Story:** As an admin user, I want the sidebar navigation labels, header text, and layout strings to appear in my selected language, so that I can navigate the panel comfortably.

#### Acceptance Criteria

1. THE Admin_Layout SHALL use Translation_Keys for all sidebar navigation labels (Dashboard, Products, Inventory, Orders, Customers, Coupons, Banners, Categories, Comments, Audit Log, Pages, Settings).
2. THE Admin_Layout SHALL use Translation_Keys for the "Admin Panel" subtitle text, "Sign Out" button label, "Sign In with Phone" button label, "First-time Setup" link, "Return to Store" link, "Admin Access Required" heading, and the "Sign in with your admin phone number to continue." descriptive paragraph.
3. THE Admin_Layout SHALL use Translation_Keys for the "Loading..." text and mobile header "Admin" label.
4. THE Admin_Layout SHALL contain zero hardcoded user-facing strings; every text node rendered in the component SHALL be produced by a `t()` call or a dynamic runtime value (e.g., storeName from environment).
5. WHEN Translation_Keys are added for Admin_Layout strings, THE i18n message modules SHALL define corresponding entries in all three locale files (az, ru, en) with non-empty values.

### Requirement 5: Admin Page Translations

**User Story:** As an admin user, I want all page headings, labels, buttons, table headers, empty states, and status text on every admin page to appear in my selected language.

#### Acceptance Criteria

1. WHEN the DashboardPage renders, THE DashboardPage SHALL use Translation_Keys for all headings (e.g., "Dashboard", "Revenue", "Orders", "Top Products", "Recent Orders"), date preset labels, KPI labels, table headers, empty states, and alert text.
2. WHEN the OrdersPage renders, THE OrdersPage SHALL use Translation_Keys for page title, table column headers, status labels (e.g., pending, processing, shipped, delivered, cancelled), action buttons, and empty state messages.
3. WHEN the ProductsPage renders, THE ProductsPage SHALL use Translation_Keys for page title, table column headers, action buttons, filter labels, and empty state messages.
4. WHEN the CategoriesPage renders, THE CategoriesPage SHALL use Translation_Keys for page title, action labels, form field labels, and empty state messages.
5. WHEN the CouponsPage renders, THE CouponsPage SHALL use Translation_Keys for page title, form field labels, table/card labels, and action buttons.
6. WHEN the BannersPage renders, THE BannersPage SHALL use Translation_Keys for page title, form labels, action buttons, and empty state messages.
7. WHEN the CommentsPage renders, THE CommentsPage SHALL use Translation_Keys for page title, status labels, action buttons, and empty state messages.
8. WHEN the AuditPage renders, THE AuditPage SHALL use Translation_Keys for page title, table column headers, and filter labels.
9. WHEN the UsersPage renders, THE UsersPage SHALL use Translation_Keys for page title, table column headers, and action labels.
10. WHEN the SettingsPage renders, THE SettingsPage SHALL use Translation_Keys for page title, section headings, form labels, and action buttons.
11. WHEN the PagesPage renders, THE PagesPage SHALL use Translation_Keys for page title, table column headers, action buttons, status indicators, and empty state messages.
12. WHEN the PageEditorPage renders, THE PageEditorPage SHALL use Translation_Keys for page title, form field labels, action buttons, and status indicators.
13. WHEN the InventoryPage renders, THE InventoryPage SHALL use Translation_Keys for page title, table column headers, and stock-related labels.
14. WHEN the OrderDetailPage renders, THE OrderDetailPage SHALL use Translation_Keys for section headings, field labels, status labels, and action buttons.
15. WHEN the ProductFormPage renders, THE ProductFormPage SHALL use Translation_Keys for all form field labels, section headings, inline form validation error messages displayed to the user, and action buttons.
16. WHEN any admin page renders with a non-"en" Admin_Locale_Preference, THE page SHALL display zero hardcoded English strings in headings, labels, buttons, table headers, empty states, or status text (excluding technical identifiers, currency symbols "AZN"/"₼", and format patterns).

### Requirement 6: Admin Shared Component Translations

**User Story:** As an admin user, I want all shared admin components (dialogs, pagination, search, export buttons, etc.) to display text in my selected language.

#### Acceptance Criteria

1. THE ConfirmDialog SHALL use Translation_Keys for default "Confirm" and "Cancel" button labels.
2. THE Pagination component SHALL use Translation_Keys for navigation labels (e.g., "← Prev", "Next →", "Page X of Y" indicator text).
3. THE SearchInput SHALL use a Translation_Key for its placeholder text.
4. THE CSVExportButton SHALL use Translation_Keys for the button label text.
5. THE TableEmptyState SHALL use Translation_Keys for default empty state messages.
6. THE BulkBar SHALL use Translation_Keys for selection count text (e.g., "{count} selected") and action labels ("Set Featured", "Unset Featured", "Set On Sale", "Unset On Sale", "Bulk Price", "Delete").
7. THE BulkPriceModal SHALL use Translation_Keys for modal title ("Bulk Price Update"), form labels ("Percentage discount", "Set fixed price"), placeholders, progress text, and action buttons ("Cancel", "Apply", "Updating…").
8. THE CategoryFilter SHALL use Translation_Keys for the "All Categories" default option and filter label.

### Requirement 7: Translation Key Namespace Structure

**User Story:** As a developer, I want admin translation keys organized under a clear namespace, so that they do not conflict with storefront keys and are easy to maintain.

#### Acceptance Criteria

1. THE Message_Files SHALL organize all admin panel translations under an "Admin" top-level namespace key, such that no admin translation key exists outside the "Admin" namespace and no storefront namespace key begins with "Admin".
2. THE Message_Files SHALL use sub-namespaces within "Admin" for each admin page (e.g., `Admin.Dashboard`, `Admin.Orders`, `Admin.Products`) and for shared admin components (e.g., `Admin.Common`, `Admin.Nav`), with a maximum nesting depth of 3 levels (e.g., `Admin.Orders.statusLabel`).
3. THE Message_Files SHALL contain identical key structures across all three locale files (az.ts, ru.ts, en.ts), where "identical key structure" means every dotted key path present in one locale file is present in all other locale files at the same nesting level with a non-empty string value.
4. IF a new admin page or shared admin component is added, THEN THE Message_Files SHALL include corresponding sub-namespace keys in all three locale files before the component references them via `t()`.

### Requirement 8: Translation Completeness

**User Story:** As a developer, I want all three locale files to have complete translations for every admin key, so that no untranslated keys appear in the UI.

#### Acceptance Criteria

1. THE Message_Files SHALL contain a translation value for every admin Translation_Key in all three locales (az, ru, en), where the English locale file (`en.ts`) is the canonical key set and the other locales must have an identical set of dot-separated key paths.
2. IF a Translation_Key is missing from a locale file at runtime, THEN THE I18n_System SHALL return the dot-path key string (e.g., "Admin.Orders.title") as a visible fallback.
3. THE existing `i18n-consistency` test SHALL validate that all three locale files share identical dot-separated key paths and that no translation value is an empty string (`""`) or a whitespace-only string.
4. WHEN a new admin Translation_Key is added to any locale file, THE Message_Files SHALL include a non-empty translation for that key in all three locales (az, ru, en) before the change is merged.

### Requirement 9: No Hardcoded Strings in Admin Panel

**User Story:** As a developer, I want to ensure no user-visible hardcoded strings remain in admin pages and components, so that the admin panel is fully translatable.

#### Acceptance Criteria

1. THE Admin_Panel pages SHALL contain no hardcoded user-visible English strings, where "user-visible" includes: rendered text content, button labels, placeholder attributes, title/tooltip attributes, aria-label attributes, toast message titles and descriptions, table column headers, and empty-state messages. Excluded from this rule are: route path strings, CSS class names, data-testid attributes, console/log messages, object keys, currency symbols ("AZN"/"₼"), date/number format pattern strings (e.g., "dd.MM.yyyy", "#,##0.00"), and HTML tag names.
2. THE Admin_Panel shared components (located in components/admin/) SHALL contain no hardcoded user-visible English strings in default prop values; any default text prop SHALL reference a Translation_Key via the `t()` function or accept the translated string from the parent component.
3. WHEN a new admin string is identified during implementation, THE developer SHALL add a corresponding Translation_Key in all three locale files (az, ru, en) before the change is merged.
4. THE Admin_Panel pages and shared components SHALL pass a static verification confirming that no JSX text node, string literal in a rendered expression, or string-typed prop among the user-visible categories defined in criterion 1 contains English alphabetic words outside the exclusion list.
