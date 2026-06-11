# Implementation Plan: White-Label Customization

## Overview

Transform the existing single-store e-commerce platform into a white-label product by introducing a `site_settings` single-row table, a CMS (`pages` + `page_translations`), a `SettingsProvider` React context with stale-while-revalidate caching, a `ThemeEngine` for runtime CSS variable injection, and admin UI for branding/typography/pages management. All hardcoded brand references are removed and replaced with dynamic settings.

## Tasks

- [x] 1. Database schema and migrations
  - [x] 1.1 Create `site_settings` table migration
    - Create SQL migration file for the `site_settings` table with all columns (id, store_name, colors, fonts, logo_url, favicon_url, contact, working_hours, footer_text, created_at, updated_at)
    - Add the single-row constraint (`CHECK (id = '00000000-0000-0000-0000-000000000001')`)
    - Seed the single row with default values
    - Enable RLS with public read policy
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 1.2 Create `pages` table migration
    - Create SQL migration for the `pages` table with columns (id, slug, is_system, published, show_in_header, show_in_footer, sort_order, created_at, updated_at)
    - Add slug format constraint (`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
    - Add sort_order range constraint (0-999)
    - Pre-seed system pages: `delivery`, `returns`, `terms`
    - Enable RLS with public read for published pages
    - _Requirements: 6.1, 6.2, 6.4, 6.6_

  - [x] 1.3 Create `page_translations` table migration
    - Create SQL migration for the `page_translations` table with columns (id, page_id, locale, title, content, meta_title, meta_description, created_at, updated_at)
    - Add foreign key to pages with CASCADE delete
    - Add UNIQUE constraint on (page_id, locale)
    - Add locale CHECK constraint for 'az', 'ru', 'en'
    - Enable RLS with public read policy
    - _Requirements: 7.1, 9.6_

  - [x] 1.4 Create `site-assets` storage bucket setup
    - Create a Supabase storage bucket named `site-assets` with `public: true`
    - Configure bucket policies for admin upload and public read
    - _Requirements: 10.5_

- [x] 2. Settings API routes
  - [x] 2.1 Implement GET `/api/site-settings` endpoint
    - Create `artifacts/api-server/src/routes/site-settings.ts`
    - Implement public GET endpoint that returns the full `site_settings` row
    - Return default settings object when no row exists (empty strings, empty JSONB, null URLs)
    - Register route in `artifacts/api-server/src/routes/index.ts`
    - _Requirements: 1.1, 1.3_

  - [x] 2.2 Implement PATCH `/api/site-settings` endpoint with validation
    - Add admin-only PATCH endpoint using `requireAdmin()` middleware
    - Validate `colors` JSONB: exactly keys primary/secondary/accent/background/text/muted, each valid HSL format `H S% L%`
    - Validate `fonts` JSONB: exactly keys heading/body, non-empty strings ≤ 100 chars
    - Ignore unrecognized fields, process only valid schema fields
    - Return 400 with field-level error details on validation failure
    - Update `updated_at` timestamp in the same transaction
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.8, 13.1_

  - [x] 2.3 Implement audit logging for settings updates
    - Write audit_log entry on successful PATCH with actor_id, action (`update_settings`), entity (`site_settings`), entity_id, and changes JSONB (only modified fields)
    - _Requirements: 1.7_

  - [x] 2.4 Write property tests for settings validation (Properties 1-4)
    - **Property 1: Partial update preserves unmodified fields**
    - **Property 2: Settings validation accepts only well-formed color palettes**
    - **Property 3: Settings validation accepts only well-formed font configurations**
    - **Property 4: Invalid settings mutations do not alter stored state**
    - **Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.8**

- [x] 3. Asset upload service
  - [x] 3.1 Implement Asset Uploader module
    - Create `artifacts/api-server/src/lib/asset-uploader.ts`
    - Validate file size (≤ 5 MB overall, ≤ 2 MB for logo, ≤ 512 KB for favicon)
    - Validate MIME type by reading file header bytes (accept image/jpeg, image/png, image/webp, image/avif)
    - Validate image dimensions (logo: ≤ 1024×1024, favicon: 16×16 to 512×512)
    - Generate unique filenames: `{category}/{timestamp}-{random8+}.{ext}`
    - Upload to `site-assets` bucket, return public CDN URL
    - Delete previous asset after successful upload (log failure, don't block)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 3.2 Implement upload endpoints for logo and favicon
    - Add `POST /api/site-settings/upload/logo` (admin-only)
    - Add `POST /api/site-settings/upload/favicon` (admin-only)
    - On successful upload, update corresponding `logo_url` or `favicon_url` in `site_settings`
    - Return appropriate error responses (413 for size, 415 for type)
    - _Requirements: 4.3, 4.5_

  - [x] 3.3 Write property tests for upload validation (Properties 8-9)
    - **Property 8: Upload validation rejects files outside constraints**
    - **Property 9: Generated filenames are unique and well-formed**
    - **Validates: Requirements 4.1, 4.2, 4.4, 10.1, 10.2, 10.3, 10.4**

- [x] 4. CMS API routes
  - [x] 4.1 Implement public pages endpoints
    - Add `GET /api/pages` — list published pages with nav flags (show_in_header, show_in_footer, sort_order)
    - Add `GET /api/pages/:slug` — get page + translation for requested locale (query param), with locale fallback (active → az → "not available")
    - Create `artifacts/api-server/src/routes/pages.ts` and register in routes index
    - _Requirements: 8.1, 8.4, 7.5_

  - [x] 4.2 Implement admin pages CRUD endpoints
    - Add `GET /api/admin/pages` — list all pages including drafts (admin-only)
    - Add `POST /api/admin/pages` — create page with slug validation (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 100 chars), uniqueness check
    - Add `PATCH /api/admin/pages/:id` — update page metadata (published, sort_order, show_in_header, show_in_footer)
    - Add `DELETE /api/admin/pages/:id` — delete non-system pages only, reject system page deletion
    - Validate title ≤ 200 chars, body ≤ 50,000 chars, sort_order 0-999
    - Update `updated_at` in same transaction on changes
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 13.3_

  - [x] 4.3 Implement page translations endpoint with HTML sanitization
    - Add `PUT /api/admin/pages/:id/translations/:locale` — upsert translation
    - Sanitize HTML content server-side using DOMPurify: allow only p, h2, h3, h4, strong, em, ul, ol, li, a, img, br, blockquote with safe attributes (href on a, src/alt on img)
    - Validate title ≤ 200 chars, content ≤ 500 KB, meta_title ≤ 160 chars, meta_description ≤ 500 chars
    - Accept content for each locale independently (partial translations allowed)
    - _Requirements: 7.1, 7.3, 7.4, 7.6, 9.6_

  - [x] 4.4 Implement CMS audit logging
    - Write audit_log entry for every page create, update, delete action
    - Record actor_id, action name, entity type (`pages`), entity_id, and changes JSONB
    - _Requirements: 6.7_

  - [x] 4.5 Write property tests for CMS validation (Properties 13-16)
    - **Property 13: CMS slug validation**
    - **Property 14: System pages cannot be deleted**
    - **Property 15: Slug uniqueness enforcement**
    - **Property 16: HTML sanitization preserves only safe elements**
    - **Validates: Requirements 6.3, 6.4, 6.5, 7.3**

- [x] 5. Checkpoint - Backend API complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. SettingsProvider and caching layer
  - [x] 6.1 Create SettingsProvider React context
    - Create `artifacts/store/src/lib/settings/context.tsx`
    - Define `SiteSettings`, `ColorPalette`, `FontConfig`, `ContactInfo` TypeScript interfaces
    - On mount: read `site_settings` from localStorage, provide immediately (same render frame)
    - Fire background fetch to `/api/site-settings` with 10-second timeout
    - Compare `updated_at` timestamps — update cache if server is newer
    - Expose `settings` object + `getStoreName(locale)` helper
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.2 Implement stale-while-revalidate logic
    - Display hardcoded defaults (white bg, black text, system sans-serif) when no cache exists
    - Treat cache as stale after 5 minutes (300s) — replace with fetch result immediately
    - On fetch failure: continue using cached settings silently, retry on next navigation
    - If cache > 24 hours AND fetch fails: fall back to hardcoded defaults
    - _Requirements: 2.4, 2.5, 2.6, 2.7_

  - [x] 6.3 Implement locale fallback for store name
    - Resolve display name: active locale → `az` fallback → literal "Store"
    - Apply same fallback pattern for working_hours and footer_text
    - _Requirements: 5.4, 5.5_

  - [x] 6.4 Write property tests for caching and locale fallback (Properties 6, 10)
    - **Property 6: Cache freshness comparison**
    - **Property 10: Locale fallback chain for store name**
    - **Validates: Requirements 2.3, 2.5, 5.4, 5.5, 13.2**

- [x] 7. ThemeEngine implementation
  - [x] 7.1 Create ThemeEngine module
    - Create `artifacts/store/src/lib/settings/theme-engine.ts`
    - Receive `ColorPalette` and `FontConfig` from SettingsProvider
    - Validate HSL ranges before applying (hue 0-360, saturation/lightness 0-100%)
    - Set CSS custom properties on `document.documentElement`: `--primary`, `--secondary`, `--accent`, `--background`, `--foreground`, `--muted`
    - Apply changes within 100ms of receiving data, no full page reload
    - _Requirements: 3.1, 3.3, 3.6_

  - [x] 7.2 Implement Google Fonts management
    - Update `--app-font-sans` and `--app-font-serif` CSS custom properties
    - Remove previously injected Google Fonts `<link>` and inject new one for selected fonts
    - Implement 3-second timeout for font loading — fall back to system font stack (`Inter, sans-serif` for body, `Georgia, serif` for headings)
    - _Requirements: 3.2, 3.4_

  - [x] 7.3 Implement favicon injection
    - Inject configured favicon URL into `<head>` as `<link rel="icon">`
    - Fall back to `/favicon.ico` when no favicon URL configured
    - _Requirements: 4.6, 4.7_

  - [x] 7.4 Write property test for ThemeEngine HSL validation (Property 7)
    - **Property 7: Theme engine validates HSL ranges before applying**
    - **Validates: Requirements 3.6**

- [x] 8. Storefront hardcoded brand removal
  - [x] 8.1 Refactor Header component to use SettingsProvider
    - Remove hardcoded `"İlk Electronics"` alt text, use `getStoreName(locale)` from SettingsProvider
    - Render logo as `<img>` using `logo_url` from settings; display store name text if no logo URL
    - Remove all hardcoded Tailwind color utility classes (e.g., `bg-gray-950`, `text-yellow-400`) and replace with CSS variable references
    - Add dynamic navigation links for published pages where `show_in_header = true`, ordered by `sort_order`
    - _Requirements: 3.5, 4.8, 4.9, 8.6, 14.1_

  - [x] 8.2 Refactor Footer component to use SettingsProvider
    - Remove hardcoded phone (`+994 55 619 59 07`), email (`info@ilkelectronics.com`), address (`Bakı, Azərbaycan`)
    - Render contact fields from `contact` setting; omit empty/null fields
    - Remove hardcoded social media URLs, render from `contact.social_links` (only non-empty `https://` links)
    - Remove `VITE_STORE_NAME` dependency, read store name from SettingsProvider
    - Remove hardcoded policy page links (`/policies/delivery`, etc.), dynamically generate from pages with `show_in_footer = true`
    - Render working_hours and footer_text from settings (locale-appropriate)
    - Remove hardcoded Tailwind color classes, use CSS variable references
    - _Requirements: 3.5, 5.2, 5.3, 5.6, 5.7, 5.8, 8.7, 14.2, 14.3, 14.4, 14.5_

  - [x] 8.3 Write property tests for storefront rendering logic (Properties 11, 12, 18)
    - **Property 11: Social links rendering filter**
    - **Property 12: Contact field omission**
    - **Property 18: Navigation links show only qualifying pages in sort order**
    - **Validates: Requirements 5.3, 5.8, 8.6, 8.7**

- [x] 9. CMS page rendering on storefront
  - [x] 9.1 Create CmsPage component and route
    - Create `artifacts/store/src/pages/storefront/CmsPage.tsx`
    - Register route at `/{locale}/page/{slug}` in the wouter router
    - Fetch page translation for active locale from `/api/pages/:slug?locale=xx`
    - Display loading indicator until response or 10-second timeout
    - Render sanitized HTML in a prose-styled container with typographic styles
    - Handle 404 (page not found / unpublished / no translation) — display existing 404 page
    - Handle network error — show error message with retry action
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.2 Implement CMS page SEO tags
    - Set document `<title>` to `meta_title` (fall back to page `title` if empty)
    - Inject `<meta name="description">` with `meta_description` (omit if empty)
    - Set `<link rel="canonical">` with absolute URL `/{locale}/page/{slug}`
    - Include `<link rel="alternate" hreflang>` for each locale where a translation exists
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.3 Write property tests for CMS rendering logic (Properties 17, 19, 20)
    - **Property 17: Page translation locale fallback**
    - **Property 19: Page visibility determines response**
    - **Property 20: Hreflang tags match existing translations**
    - **Validates: Requirements 7.5, 8.4, 9.5**

- [x] 10. Checkpoint - Storefront integration complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Admin Panel - Site Settings page
  - [x] 11.1 Implement Settings page Branding tab
    - Enhance existing `artifacts/store/src/pages/admin/SettingsPage.tsx` with tab navigation (Branding, Identity & Contact, Typography)
    - Add color pickers for each palette color (primary, secondary, accent, background, text, muted) — hex input with live preview swatch
    - Add logo and favicon upload with file picker, preview, and validation feedback
    - Implement hex → HSL conversion for storage
    - _Requirements: 11.1, 11.2_

  - [x] 11.2 Implement Settings page Identity & Contact tab
    - Add form fields: store name (per locale, 3 inputs, max 100 chars each), phone (max 20 chars), email (max 254 chars), address (max 200 chars)
    - Add social links fields: Instagram, Facebook, Telegram (each max 255 chars)
    - Add working hours (free-text, max 200 chars) and footer text (per locale, max 500 chars)
    - _Requirements: 11.3_

  - [x] 11.3 Implement Settings page Typography tab
    - Add font dropdowns for heading and body font selection
    - Curate list of 10-30 Google Fonts, display font names in their respective typeface
    - _Requirements: 11.4_

  - [x] 11.4 Implement Settings page save flow and validation
    - Client-side validation: email format, URL starts with `https://`, phone digits/+ only, max character limits
    - Display inline error messages below invalid fields, scroll to first invalid field
    - Prevent save request if validation fails
    - On success: display success notification (3 seconds)
    - On failure: display error notification, preserve form values for retry
    - _Requirements: 11.5, 11.6, 11.7, 11.8_

  - [x] 11.5 Write property test for client-side settings validation (Property 21)
    - **Property 21: Client-side settings validation**
    - **Validates: Requirements 11.7**

- [x] 12. Admin Panel - CMS Pages management
  - [x] 12.1 Create Pages list page
    - Create `artifacts/store/src/pages/admin/PagesPage.tsx` at `/admin/pages`
    - Display table with title, slug, published status, show_in_header, show_in_footer columns
    - Show system page badge, hide delete action for system pages
    - Implement published toggle with immediate API call and success notification
    - Support sort_order editing (drag-and-drop or manual input), persist within 2 seconds
    - Add delete action with confirmation dialog for non-system pages
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 12.2 Create Page editor page with TipTap rich-text editor
    - Create `artifacts/store/src/pages/admin/PageEditorPage.tsx` at `/admin/pages/:id/edit`
    - Integrate TipTap editor supporting: h2, h3, h4, bold, italic, ordered lists, unordered lists, links, images
    - Add locale tabs (az, ru, en) for per-locale content editing
    - Add SEO fields: meta_title, meta_description
    - Add toggle switches for show_in_header, show_in_footer
    - Handle save errors with error notification, preserve form data
    - _Requirements: 7.2, 12.2, 12.6_

  - [x] 12.3 Register admin routes for Pages and Page Editor
    - Add `/admin/pages` and `/admin/pages/:id/edit` routes in the admin router
    - Add "Pages" navigation item in admin sidebar/layout
    - _Requirements: 12.1_

- [x] 13. Checkpoint - Admin panel complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Integration wiring and cache invalidation
  - [x] 14.1 Wire SettingsProvider into App root
    - Wrap storefront routes with `SettingsProvider` in `App.tsx`
    - Ensure ThemeEngine applies on initial load and on settings updates
    - Trigger background revalidation on each route navigation
    - _Requirements: 2.1, 2.2, 13.4, 13.6_

  - [x] 14.2 Verify default rendering without custom settings
    - Ensure storefront renders correctly with default settings values when no custom settings configured
    - White background, black text, system sans-serif font
    - Store name displays "Store" when no locale-specific name set
    - _Requirements: 14.6_

  - [x] 14.3 Write property test for audit logging (Property 5)
    - **Property 5: All admin mutations produce audit log entries**
    - **Validates: Requirements 1.7, 6.7**

- [x] 15. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript throughout (React 19 + Express 5 + Vitest)
- All admin endpoints must use the existing `requireAdmin()` middleware pattern
- CSS custom properties enable runtime theming without Tailwind rebuild
- The stale-while-revalidate pattern ensures instant loads while keeping data fresh

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "4.2", "4.3", "4.4"] },
    { "id": 3, "tasks": ["2.4", "3.2", "4.5"] },
    { "id": 4, "tasks": ["3.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 6, "tasks": ["6.4", "7.2", "7.3"] },
    { "id": 7, "tasks": ["7.4", "8.1", "8.2"] },
    { "id": 8, "tasks": ["8.3", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 11, "tasks": ["11.4", "11.5", "12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3"] },
    { "id": 13, "tasks": ["14.1"] },
    { "id": 14, "tasks": ["14.2", "14.3"] }
  ]
}
```
