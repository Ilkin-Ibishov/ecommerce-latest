# Implementation Plan

## Overview

Replace hardcoded user-facing strings across 15 storefront components/pages with `t()` translation calls. The fix pattern is uniform: add translation keys to messages.ts, then replace literals with `t("Section.key")` in each component. Wave 0 adds all keys (sequential dependency), Wave 1 fixes all 15 files in parallel, Wave 2 validates.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Hardcoded Strings Ignore Locale Switch
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate hardcoded strings don't respond to locale changes
  - **Scoped PBT Approach**: For each affected component, verify that rendered text output changes when locale switches from "az" to "ru" or "en"
  - Test file: `artifacts/store/src/__tests__/i18n-hardcoded-strings.property.test.ts`
  - Property: For all components in [Footer, CartDrawer, Header, TrustBadges, ProductDetail, ProductCard, MobileBottomNav, AnnouncementBar, RecentlyViewed, CheckoutPage, ProductsPage, SearchPage, WishlistPage, ProfilePage, LoginModal] and for all locales in ["ru", "en"], the component's user-facing text output MUST differ from the "az" locale output
  - Bug condition from design: `isBugCondition(component, locale) := locale ∈ {"ru", "en"} AND component ∈ affectedComponents AND component.renderedText === component.azText`
  - Expected behavior: `expectedBehavior(component, locale) := component.renderedText === messages[locale][component.section].*`
  - Run test on UNFIXED code — expect FAILURE (confirms hardcoded strings exist)
  - Document counterexamples: e.g., "Footer renders 'Mağaza' when locale='en' instead of 'Store'"
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Azerbaijani Locale Output Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: When locale="az", all 15 components render their current Azerbaijani text correctly
  - Observe: HeroCarousel renders API-sourced banner content without modification
  - Observe: Product titles/descriptions come from `product_translations` database records
  - Observe: Currency code "AZN" renders as literal text
  - Observe: Phone numbers, emails, and addresses in Footer render as literals
  - Write property-based test: For all affected components, when locale="az", rendered user-facing text matches the current hardcoded Azerbaijani strings (which will become messages.ts az values)
  - Property: `preservation(component) := component.render(locale="az").text === currentAzText[component]`
  - Verify test passes on UNFIXED code (baseline behavior confirmed)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Wave 0 — Add ALL translation keys to messages.ts
  - Read all 15 affected component files to catalog every hardcoded user-facing string
  - Add new top-level sections to `artifacts/store/src/lib/i18n/messages.ts` for all three locales (az, ru, en):
    - `Footer`: keys for "Mağaza", "Məlumat", "Əlaqə", "Bütün hüquqlar qorunur", navigation links, etc.
    - `CartDrawer`: keys for "Səbət", "Səbətiniz boşdur", "Sifariş ver", "Cəmi", "Promo kodunuz var?", "Tətbiq et", "Pulsuz çatdırılma qazandınız!", etc.
    - `Header`: keys for "Məhsullar", "Kateqoriyalar", "Sifarişlərim", "İstək siyahısı", "Daxil ol", "Çıxış", etc.
    - `TrustBadges`: keys for "Pulsuz Çatdırılma", "Çatdırılmada Ödəniş", "Asan Qaytarma", "Təhlükəsiz Alış-veriş"
    - `ProductDetail`: keys for "Səbətə əlavə et", "Stokda var", "Stokda yoxdur", "Məhsul haqqında", "Rəylər", "Ana səhifə", "Oxşar məhsullar", etc.
    - `ProductCard`: keys for "Stokda yoxdur", installment text template "Ayda {amount} AZN — {months} aya"
    - `MobileBottomNav`: keys for "Ana səhifə", "Məhsullar", "Axtar", "Səbət", "Hesab"
    - `AnnouncementBar`: keys for announcement text
    - `RecentlyViewed`: keys for "Son baxılan məhsullar"
    - `Checkout`: keys for "Sifariş ver", "Məlumatlarınız", "Çatdırılma ünvanı", "Sifariş icmalı", "Sifariş qəbul edildi!", form labels, etc.
    - `Products`: keys for "Bütün məhsullar", "Endirimli məhsullar", "Filtrlər", sort options, filter labels, etc.
    - `Search`: keys for "Search results for", "results found", "No products found"
    - `Wishlist`: keys for "Your Wishlist", "Sign in to save products", "Browse products"
    - `Profile`: keys for "My Profile", "Personal Info", "My Orders", "Sign Out", "No orders yet", etc.
    - `LoginModal`: keys for "Sign in with WhatsApp", "Send Code", "Enter verification code", "Verify Code"
  - All keys MUST have values for az, ru, and en locales
  - Preserve existing key sections (HomePage, Auth, Common) — do NOT modify them
  - Exclude from translation: currency codes ("AZN"), phone numbers, email addresses, URLs, technical strings
  - _Bug_Condition: isBugCondition(component, locale) where locale ∈ {"ru","en"} AND text is hardcoded_
  - _Expected_Behavior: All user-facing strings available via t() for all 3 locales_
  - _Preservation: Existing HomePage, Auth, Common sections unchanged_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 3.1_

- [x] 4. Wave 1 — Fix components (parallel execution)

  - [x] 4.1 Fix Footer.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/Footer.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Mağaza", "Məlumat", "Əlaqə", "Bütün hüquqlar qorunur", section headings, navigation labels)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Footer.keyName")` using keys added in Wave 0
    - Do NOT translate: phone numbers, email addresses, physical addresses, URLs, "AZN"
    - _Requirements: 2.1, 3.7_

  - [x] 4.2 Fix CartDrawer.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/CartDrawer.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Səbət", "Səbətiniz boşdur", "Sifariş ver", "Cəmi", "Promo kodunuz var?", "Tətbiq et", "Pulsuz çatdırılma qazandınız!", quantity labels, remove button text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("CartDrawer.keyName")` using keys added in Wave 0
    - Do NOT translate: currency codes "AZN", numeric values
    - _Requirements: 2.2_

  - [x] 4.3 Fix Header.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/Header.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Məhsullar", "Kateqoriyalar", "Sifarişlərim", "İstək siyahısı", "Daxil ol", "Çıxış", search placeholder, navigation items)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Header.keyName")` using keys added in Wave 0
    - _Requirements: 2.3_

  - [x] 4.4 Fix TrustBadges.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/TrustBadges.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Pulsuz Çatdırılma", "Çatdırılmada Ödəniş", "Asan Qaytarma", "Təhlükəsiz Alış-veriş", any subtitles/descriptions)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("TrustBadges.keyName")` using keys added in Wave 0
    - _Requirements: 2.4_

  - [x] 4.5 Fix ProductDetail.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/ProductDetail.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Səbətə əlavə et", "Stokda var", "Stokda yoxdur", "Məhsul haqqında", "Rəylər", "Ana səhifə", "Oxşar məhsullar", breadcrumb labels, tab labels, button text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("ProductDetail.keyName")` using keys added in Wave 0
    - Do NOT translate: product titles/descriptions (these come from product_translations DB records), "AZN"
    - _Requirements: 2.5, 3.5_

  - [x] 4.6 Fix ProductCard.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/ProductCard.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Stokda yoxdur", installment text pattern "Ayda ... AZN — 12 aya", badges, button labels)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("ProductCard.keyName")` using keys added in Wave 0
    - For installment template strings, use interpolation or template with t() for the text parts
    - Do NOT translate: product titles (from DB), "AZN", numeric values
    - _Requirements: 2.6, 3.5_

  - [x] 4.7 Fix MobileBottomNav.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/MobileBottomNav.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Ana səhifə", "Məhsullar", "Axtar", "Səbət", "Hesab")
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("MobileBottomNav.keyName")` using keys added in Wave 0
    - _Requirements: 2.7_

  - [x] 4.8 Fix AnnouncementBar.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/AnnouncementBar.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma · Bütün Azərbaycan üzrə")
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("AnnouncementBar.keyName")` using keys added in Wave 0
    - _Requirements: 2.8_

  - [x] 4.9 Fix RecentlyViewed.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/storefront/RecentlyViewed.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Son baxılan məhsullar", any empty state text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("RecentlyViewed.keyName")` using keys added in Wave 0
    - _Requirements: 2.9_

  - [x] 4.10 Fix CheckoutPage.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/pages/storefront/CheckoutPage.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Sifariş ver", "Məlumatlarınız", "Çatdırılma ünvanı", "Sifariş icmalı", "Sifariş qəbul edildi!", form field labels, button text, validation messages, success page text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Checkout.keyName")` using keys added in Wave 0
    - Do NOT translate: "AZN", numeric order totals
    - _Requirements: 2.10_

  - [x] 4.11 Fix ProductsPage.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/pages/storefront/ProductsPage.tsx`
    - Read file, identify ALL hardcoded user-facing strings (Azerbaijani text: "Bütün məhsullar", "Endirimli məhsullar", "Filtrlər", sort option labels like "Ən yeni", "Ucuzdan bahaya", filter labels, category names that are hardcoded, empty state text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Products.keyName")` using keys added in Wave 0
    - Do NOT translate: category names from DB (if dynamic), "AZN"
    - _Requirements: 2.11_

  - [x] 4.12 Fix SearchPage.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/pages/storefront/SearchPage.tsx`
    - Read file, identify ALL hardcoded user-facing strings (English text: "Search results for", "results found", "No products found", any placeholder text, empty state messaging)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Search.keyName")` using keys added in Wave 0
    - _Requirements: 2.12_

  - [x] 4.13 Fix WishlistPage.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/pages/storefront/WishlistPage.tsx`
    - Read file, identify ALL hardcoded user-facing strings (English text: "Your Wishlist", "Sign in to save products", "Browse products", empty state text, item count, remove button labels)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Wishlist.keyName")` using keys added in Wave 0
    - _Requirements: 2.13_

  - [x] 4.14 Fix ProfilePage.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/pages/storefront/ProfilePage.tsx`
    - Read file, identify ALL hardcoded user-facing strings (English text: "My Profile", "Personal Info", "My Orders", "Sign Out", "No orders yet", tab labels, form labels, button text, empty states)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("Profile.keyName")` using keys added in Wave 0
    - _Requirements: 2.14_

  - [x] 4.15 Fix LoginModal.tsx — replace hardcoded strings with t() calls
    - File: `artifacts/store/src/components/auth/LoginModal.tsx`
    - Read file, identify ALL hardcoded user-facing strings (English text: "Sign in with WhatsApp", "Send Code", "Enter verification code", "Verify Code", modal title, step labels, input placeholders, button text)
    - Ensure `useI18n()` is imported: `import { useI18n } from "@/lib/i18n/context"`
    - Add `const { t } = useI18n();` if not already present
    - Replace each hardcoded string with `t("LoginModal.keyName")` using keys added in Wave 0
    - Note: Some keys may overlap with existing `Auth.*` keys — reuse those where applicable
    - _Requirements: 2.15_

- [x] 5. Fix for i18n hardcoded strings

  - [x] 5.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - All Components Respond to Locale Switch
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (components render locale-appropriate text)
    - When this test passes, it confirms all 15 components now use t() correctly
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed for all components)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15_

  - [x] 5.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Azerbaijani Locale Output Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for az locale)
    - Confirm all Azerbaijani text renders identically to before the fix
    - Confirm HeroCarousel, product_translations content, currency codes, and contact info are unaffected
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. Checkpoint — Ensure all tests pass and no hardcoded strings remain
  - Run full TypeScript typecheck: `pnpm run typecheck`
  - Run project build: `pnpm run build`
  - Grep all 15 fixed files for remaining hardcoded Azerbaijani/English user-facing strings (should find none except excluded items: AZN, phone numbers, emails, URLs)
  - Verify messages.ts has complete key coverage for all 3 locales (no missing translations)
  - Ensure all tests pass, ask the user if questions arise


## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 0 - Exploration & Preservation Tests",
      "tasks": ["1", "2"],
      "description": "Write property-based tests on unfixed code to establish baseline"
    },
    {
      "name": "Wave 1 - Add Translation Keys",
      "tasks": ["3"],
      "dependsOn": ["1", "2"],
      "description": "Add all missing translation keys to messages.ts for all 3 locales"
    },
    {
      "name": "Wave 2 - Fix Components (PARALLEL)",
      "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15"],
      "dependsOn": ["3"],
      "description": "Replace hardcoded strings with t() calls in all 15 files — all tasks independent, run in parallel"
    },
    {
      "name": "Wave 3 - Verify Fix",
      "tasks": ["5.1", "5.2"],
      "dependsOn": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15"],
      "description": "Re-run exploration and preservation tests to confirm fix works without regressions"
    },
    {
      "name": "Wave 4 - Checkpoint",
      "tasks": ["6"],
      "dependsOn": ["5.1", "5.2"],
      "description": "Final validation: typecheck, build, grep audit for remaining hardcoded strings"
    }
  ]
}
```

## Notes

- The fix pattern is identical across all 15 components: import useI18n, destructure t, replace string literals with t("Section.key")
- Wave 1 tasks (4.1–4.15) are designed for parallel execution by independent sub-agents since they modify separate files and all depend only on the shared messages.ts created in Wave 0
- Strings to exclude from translation: "AZN" (currency code), phone numbers, email addresses, URLs, physical addresses, product titles/descriptions (sourced from DB)
- Existing translation sections (HomePage, Auth, Common) must NOT be modified
- Translation key naming convention: `SectionName.camelCaseKey` (e.g., `Footer.store`, `CartDrawer.emptyCart`)
