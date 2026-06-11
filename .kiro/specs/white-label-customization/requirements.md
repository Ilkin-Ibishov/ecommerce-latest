# Requirements Document

## Introduction

This feature transforms the existing single-store e-commerce platform into a white-label product. Each deployment serves one client (single-tenant: one Supabase + one Vercel instance). The admin panel exposes branding, contact information, typography, and CMS page management so that non-technical operators can fully customize their storefront without code changes.

## Glossary

- **Settings_Service**: The backend API responsible for persisting and serving site-wide configuration from the `site_settings` table.
- **Settings_Provider**: The React context provider that fetches, caches, and distributes site settings to all storefront components via a stale-while-revalidate pattern with localStorage.
- **Theme_Engine**: The subsystem that applies color palette and typography selections as CSS custom properties on the `:root` element at runtime.
- **CMS_Service**: The backend API responsible for CRUD operations on the `pages` and `page_translations` tables.
- **CMS_Renderer**: The storefront component that fetches and renders CMS page content as sanitized HTML within a locale-aware route.
- **Asset_Uploader**: The server-side handler that validates, processes, and stores image assets (logo, favicon, PWA icons) in Supabase Storage.
- **Admin_Panel**: The authenticated admin interface at `/admin/` where operators manage settings and pages.
- **Storefront**: The public-facing React SPA serving customers at locale-prefixed routes (`/az/`, `/ru/`, `/en/`).
- **Locale**: One of the three supported languages: `az`, `ru`, `en`.

## Requirements

### Requirement 1: Site Settings Storage and Retrieval

**User Story:** As a platform operator, I want all branding and identity settings stored in a single database row, so that the storefront can load them with one query.

#### Acceptance Criteria

1. THE Settings_Service SHALL expose a public GET endpoint that returns the full `site_settings` row as a JSON object without requiring authentication.
2. THE Settings_Service SHALL expose an admin-only PATCH endpoint that accepts a partial JSON body and updates only the provided fields in the `site_settings` row, leaving unspecified fields unchanged.
3. WHEN the `site_settings` table contains no rows, THE Settings_Service SHALL return a default settings object with empty strings for text fields, empty JSONB objects for `colors` and `fonts`, and null for URL fields (`logo_url`, `favicon_url`).
4. THE Settings_Service SHALL validate that the `colors` JSONB field contains exactly the keys: primary, secondary, accent, background, text, muted, each as a valid CSS HSL color string in the format `H S% L%` (e.g., `220 70% 50%`).
5. THE Settings_Service SHALL validate that the `fonts` JSONB field contains exactly the keys `heading` and `body`, each as a non-empty string of at most 100 characters referencing a font family name.
6. IF the PATCH request body fails validation, THEN THE Settings_Service SHALL return a 400 status response with an error message indicating which fields failed validation, and SHALL NOT modify the stored settings.
7. WHEN an admin updates settings, THE Settings_Service SHALL write an entry to the `audit_log` table with `actor_id` set to the admin's user ID, `action` set to `update_settings`, `entity` set to `site_settings`, `entity_id` set to the row ID, and `changes` set to a JSONB object containing only the modified fields.
8. IF the PATCH request contains field names that do not exist in the `site_settings` schema, THEN THE Settings_Service SHALL ignore unrecognized fields and process only valid fields.

### Requirement 2: Runtime Settings Caching (Stale-While-Revalidate)

**User Story:** As a storefront visitor, I want the page to load instantly with cached settings, so that I do not experience blank or un-styled flashes.

#### Acceptance Criteria

1. WHEN the Storefront renders for the first time in a browser session, THE Settings_Provider SHALL read cached settings from localStorage and apply them to the UI within the same render frame, before any network request completes.
2. WHEN a page load or client-side route navigation occurs, THE Settings_Provider SHALL initiate a background fetch of fresh settings from the Settings_Service with a request timeout of 10 seconds.
3. WHEN the background fetch completes successfully and the fetched `updated_at` timestamp is more recent than the cached timestamp, THE Settings_Provider SHALL update localStorage with the fetched data and apply the new settings to the current UI without a full page reload.
4. WHEN localStorage contains no cached settings, THE Settings_Provider SHALL display hardcoded default values (white background, black text, system sans-serif font) until the initial fetch completes or the 10-second timeout elapses, whichever comes first.
5. WHILE cached settings are older than 5 minutes (300 seconds), THE Settings_Provider SHALL treat them as stale and replace them with the background fetch result as soon as it becomes available.
6. IF the background fetch fails or times out, THEN THE Settings_Provider SHALL continue using cached settings without showing an error to the user and shall retry on the next route navigation.
7. IF cached settings are older than 24 hours and the background fetch fails, THEN THE Settings_Provider SHALL fall back to the hardcoded default values (white background, black text, system sans-serif font).

### Requirement 3: Dynamic Theme Application

**User Story:** As a platform operator, I want color and font changes to reflect immediately on the storefront, so that I can see the result of my branding decisions.

#### Acceptance Criteria

1. WHEN the Settings_Provider receives a color palette, THE Theme_Engine SHALL set CSS custom properties (`--primary`, `--secondary`, `--accent`, `--background`, `--foreground`, `--muted`) on the `:root` element using the configured HSL values within 100 milliseconds of receiving the data.
2. WHEN the Settings_Provider receives font selections, THE Theme_Engine SHALL update the `--app-font-sans` and `--app-font-serif` CSS custom properties on `:root`, remove any previously injected Google Fonts `<link>` element, and inject a new Google Fonts `<link>` element into `<head>` for the selected fonts.
3. THE Theme_Engine SHALL apply theme changes without triggering a full page reload, using JavaScript DOM style manipulation to update CSS custom properties in place.
4. IF a font family fails to load from Google Fonts within 3 seconds or returns a network error, THEN THE Theme_Engine SHALL fall back to the system font stack (`Inter, sans-serif` for body, `Georgia, serif` for headings) and retain the fallback until a subsequent successful font load.
5. THE Storefront SHALL remove all hardcoded color references (e.g., `bg-gray-950`, `text-yellow-400`, `hover:text-yellow-400`) from the Header and Footer components and replace them with theme-aware CSS variable references such that no Tailwind color utility classes with literal color values remain in those components.
6. IF the Settings_Provider receives a color palette containing HSL values outside valid ranges (hue not 0–360, saturation or lightness not 0–100%), THEN THE Theme_Engine SHALL retain the previously applied color values and not update the `:root` properties.

### Requirement 4: Logo and Favicon Management

**User Story:** As a platform operator, I want to upload my own logo and favicon through the admin panel, so that my brand identity appears across the storefront.

#### Acceptance Criteria

1. WHEN an admin uploads a logo file, THE Asset_Uploader SHALL validate that the file is PNG, SVG, or WebP format and does not exceed 2 MB, and that the image dimensions do not exceed 1024×1024 pixels.
2. WHEN an admin uploads a favicon file, THE Asset_Uploader SHALL validate that the file is ICO, PNG, or SVG format and does not exceed 512 KB, and that the image dimensions are between 16×16 and 512×512 pixels.
3. WHEN a valid image is uploaded, THE Asset_Uploader SHALL store it in the `site-assets` Supabase Storage bucket with a unique filename and return the public CDN URL.
4. IF an uploaded file fails validation (wrong format, exceeds size limit, or exceeds dimension limit), THEN THE Asset_Uploader SHALL reject the upload and return an error message indicating which validation rule was violated, without modifying existing stored assets.
5. WHEN a valid logo or favicon image is uploaded and stored, THE Settings_Service SHALL update the corresponding `logo_url` or `favicon_url` field in the `site_settings` row with the returned CDN URL.
6. WHEN the Storefront renders, THE Settings_Provider SHALL inject the configured favicon URL into the document `<head>` as a `<link rel="icon">` element.
7. IF no favicon URL is configured, THEN THE Storefront SHALL use the default `/favicon.ico` file as the `<link rel="icon">` element.
8. THE Storefront Header and Footer components SHALL render the logo as an `<img>` element using the `logo_url` setting as the `src` attribute and the store name (in the active locale) as the `alt` attribute, instead of the hardcoded `/logo.png` path.
9. IF no logo URL is configured, THEN THE Storefront SHALL display the store name in the active locale as text in place of the logo image.

### Requirement 5: Store Identity and Contact Information

**User Story:** As a platform operator, I want to configure my store name, contact details, and working hours from the admin panel, so that customers see accurate business information.

#### Acceptance Criteria

1. THE Settings_Service SHALL store `store_name` as a JSONB object with keys for each locale (`az`, `ru`, `en`), each value being a non-empty string of at most 100 characters.
2. THE Storefront Footer SHALL render the contact phone, email, and address from the `contact` JSONB field in `site_settings` instead of hardcoded values.
3. THE Storefront Footer SHALL render social media links from the `contact.social_links` object, showing only links where the URL value is a non-empty string starting with `https://`.
4. WHEN a locale-specific store name is not defined (null, undefined, or empty string) for the active locale, THE Storefront SHALL fall back to the `az` locale value.
5. IF the `az` locale value is also not defined, THEN THE Storefront SHALL display the literal text "Store" as the store name.
6. THE Settings_Service SHALL store `working_hours` as a JSONB object with locale keys (`az`, `ru`, `en`), each containing a string of at most 200 characters, and THE Storefront Footer SHALL display the locale-appropriate working hours text.
7. THE Settings_Service SHALL store `footer_text` as a JSONB object with locale keys (`az`, `ru`, `en`), each containing a string of at most 500 characters, and THE Storefront Footer SHALL render the locale-appropriate footer text.
8. IF a contact field (phone, email, or address) is empty or null, THEN THE Storefront Footer SHALL omit that field from rendering rather than displaying empty space.

### Requirement 6: CMS Page Management

**User Story:** As a platform operator, I want to create and manage content pages (delivery terms, returns policy, custom pages), so that customers can access store policies and information.

#### Acceptance Criteria

1. THE CMS_Service SHALL expose admin-only endpoints for creating, updating, listing, and deleting pages, where each page consists of a title (maximum 200 characters), a slug, and a body (maximum 50,000 characters).
2. WHEN the database is initialized, THE CMS_Service SHALL pre-seed three system pages with slugs `delivery`, `returns`, and `terms` with `is_system` set to `true`.
3. IF an admin attempts to delete a page where `is_system` is `true`, THEN THE CMS_Service SHALL reject the request and return an error response indicating that system pages cannot be deleted.
4. WHEN an admin creates a custom page, THE CMS_Service SHALL require a unique slug matching the pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` with a maximum length of 100 characters.
5. IF an admin creates or updates a page with a slug that already exists on another page, THEN THE CMS_Service SHALL reject the request and return an error response indicating the slug is already in use.
6. THE CMS_Service SHALL support setting `published` (boolean), `sort_order` (integer, 0 to 999), `show_in_header` (boolean), and `show_in_footer` (boolean) flags per page.
7. THE CMS_Service SHALL write an entry to the `audit_log` table for every page create, update, or delete action, recording the actor_id, action name, entity type, entity_id, and changes.

### Requirement 7: CMS Page Translations and Rich Text

**User Story:** As a platform operator, I want to write page content in multiple languages using a rich-text editor, so that customers see properly formatted content in their language.

#### Acceptance Criteria

1. THE CMS_Service SHALL store page content in the `page_translations` table with columns: `page_id`, `locale`, `title` (maximum 200 characters), `content` (HTML, maximum 500 KB), `meta_title` (maximum 120 characters), `meta_description` (maximum 320 characters).
2. THE Admin_Panel SHALL render a TipTap rich-text editor for the `content` field, supporting headings (h2, h3, h4), bold, italic, ordered lists, unordered lists, links (with href attribute), and images (with src and alt attributes).
3. WHEN saving page content, THE CMS_Service SHALL sanitize the HTML content by allowing only the elements `p`, `h2`, `h3`, `h4`, `strong`, `em`, `ul`, `ol`, `li`, `a`, `img`, `br`, and `blockquote` with their safe attributes (`href` on `a`, `src` and `alt` on `img`) and removing all other elements, attributes, script tags, event handlers, and iframes.
4. THE CMS_Service SHALL accept content for each locale independently, allowing partial translations (not all locales required simultaneously).
5. WHEN a page translation does not exist for the active locale, THE CMS_Renderer SHALL fall back to the `az` locale content, and if that also does not exist, display a "content not available" message.
6. IF the `title` field is empty or the `content` field exceeds 500 KB when saving a page translation, THEN THE CMS_Service SHALL reject the request with a validation error message indicating which field failed validation.

### Requirement 8: CMS Page Routing and Rendering

**User Story:** As a customer, I want to view CMS pages at readable URLs in my language, so that I can access store policies and information easily.

#### Acceptance Criteria

1. THE Storefront SHALL route CMS pages at `/{locale}/page/{slug}` using the existing wouter router, where `slug` contains only lowercase alphanumeric characters and hyphens with a maximum length of 128 characters.
2. WHEN a CMS page route is accessed, THE CMS_Renderer SHALL fetch the page translation for the active locale from the CMS_Service and display a loading indicator until the response is received or a timeout of 10 seconds elapses.
3. WHEN the CMS_Service returns page content, THE CMS_Renderer SHALL render the sanitized HTML content inside a styled container that applies base typographic styles (headings, paragraphs, lists, links) consistent with the storefront design system.
4. IF the requested page does not exist, is not published, or has no translation available for the active locale, THEN THE CMS_Renderer SHALL display the existing 404 page.
5. IF the CMS_Service request fails due to a network error or timeout, THEN THE CMS_Renderer SHALL display an error message indicating the page could not be loaded and provide a retry action.
6. THE Storefront Header SHALL display navigation links to published pages where `show_in_header` is `true`, labeled with the page title in the active locale, ordered by `sort_order` ascending.
7. THE Storefront Footer SHALL display navigation links to published pages where `show_in_footer` is `true`, labeled with the page title in the active locale, ordered by `sort_order` ascending.

### Requirement 9: CMS Page SEO

**User Story:** As a platform operator, I want to configure meta titles and descriptions for each CMS page, so that search engines can properly index and display my content.

#### Acceptance Criteria

1. WHEN a CMS page is rendered, THE CMS_Renderer SHALL set the document `<title>` to the `meta_title` value from the active locale's page translation, and inject a `<meta name="description">` tag in the document `<head>` with the `meta_description` value.
2. WHEN `meta_title` is empty (null, undefined, or whitespace-only) for a page translation, THE CMS_Renderer SHALL use the page translation `title` field as the document `<title>`.
3. WHEN `meta_description` is empty (null, undefined, or whitespace-only) for a page translation, THE CMS_Renderer SHALL omit the `<meta name="description">` tag from the document `<head>`.
4. WHEN a CMS page is rendered, THE CMS_Renderer SHALL set a `<link rel="canonical">` tag in the document `<head>` with the `href` pointing to the absolute URL of the current page in the active locale format `/{locale}/page/{slug}`.
5. WHEN a CMS page is rendered, THE CMS_Renderer SHALL include a `<link rel="alternate" hreflang="{locale}">` tag for each locale (`az`, `ru`, `en`) where a translation record exists for that page, with the `href` pointing to the absolute URL of that locale's version (`/{locale}/page/{slug}`).
6. THE CMS_Service SHALL enforce a maximum length of 160 characters for `meta_title` and 500 characters for `meta_description` when saving page translations, rejecting values that exceed these limits.

### Requirement 10: Image Upload Validation and Security

**User Story:** As a platform operator, I want the system to validate my image uploads, so that only safe and appropriately sized files are stored.

#### Acceptance Criteria

1. WHEN an image upload request exceeds 5 MB, THE Asset_Uploader SHALL reject the request with a 413 status and an error message indicating the file exceeds the maximum allowed size of 5 MB.
2. THE Asset_Uploader SHALL validate the file's MIME type by reading the file header bytes and SHALL accept only the following types: image/jpeg, image/png, image/webp, and image/avif.
3. IF the file header bytes do not match any accepted MIME type, THEN THE Asset_Uploader SHALL reject the request with a 415 status and an error message indicating the file type is not supported.
4. THE Asset_Uploader SHALL generate unique filenames using a timestamp and a random alphanumeric suffix of at least 8 characters to prevent filename collisions.
5. WHEN uploading to the `site-assets` bucket, THE Asset_Uploader SHALL ensure the bucket exists and is configured with `public: true` for CDN serving, creating it if it does not already exist.
6. IF a previous asset exists at the same logical path (identified by the combination of asset category and asset purpose, e.g., "branding/logo"), THEN THE Asset_Uploader SHALL delete the old file from storage only after the new file is successfully uploaded and confirmed stored.
7. IF deletion of the previous asset fails after a successful new upload, THEN THE Asset_Uploader SHALL log the failure and return a success response for the new upload without blocking the operation.

### Requirement 11: Admin Panel UI for Settings

**User Story:** As a platform operator, I want a dedicated settings page in the admin panel with organized sections, so that I can easily configure all branding and identity options.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a "Site Settings" page at `/admin/settings` with tabs or sections for: Branding, Identity & Contact, and Typography, where each section is reachable without a full page reload.
2. THE Admin_Panel Branding section SHALL include a color picker for each color in the palette (primary, secondary, accent, background, text, muted) that accepts and displays values in 6-digit hex format, and SHALL render a preview swatch next to each picker that updates immediately upon color value change.
3. THE Admin_Panel Identity section SHALL include form fields for store name (per locale, maximum 100 characters each), phone (maximum 20 characters), email (maximum 254 characters), address (maximum 200 characters), social links (Instagram, Facebook, Telegram — each maximum 255 characters), and working hours (free-text field, maximum 200 characters).
4. THE Admin_Panel Typography section SHALL include dropdowns for heading and body font selection from a curated list of at least 10 and at most 30 Google Fonts, displaying font names in their respective typeface within the dropdown.
5. WHEN the admin clicks the save button and the request succeeds, THE Admin_Panel SHALL display a success notification for 3 seconds and the Storefront SHALL reflect changes within the cache TTL period (5 minutes) without requiring a deployment.
6. IF the save request fails due to a network error or server error, THEN THE Admin_Panel SHALL display an error notification indicating the failure reason and SHALL preserve all unsaved field values so the admin can retry without re-entering data.
7. THE Admin_Panel SHALL validate all fields client-side before submission: email fields against a standard email format, URL fields for valid URL format starting with "https://", phone field for digits and "+" only, and all text fields against their maximum character limits — and SHALL display an inline error message below each invalid field.
8. IF client-side validation fails on submission, THEN THE Admin_Panel SHALL prevent the save request from being sent and SHALL scroll to the first invalid field.

### Requirement 12: Admin Panel UI for CMS Pages

**User Story:** As a platform operator, I want a dedicated pages management interface, so that I can create, edit, and organize content pages.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a "Pages" page at `/admin/pages` listing all pages with their title, slug, published status, and navigation placement columns showing `show_in_header` and `show_in_footer` values.
2. THE Admin_Panel SHALL provide a page editor accessible from the pages list, containing the TipTap rich-text editor, locale tabs for each supported locale (az, ru, en), SEO fields (`meta_title` and `meta_description`), and toggle switches for `show_in_header` and `show_in_footer`.
3. THE Admin_Panel SHALL display system pages (where `is_system` is `true`) with a visual badge and SHALL hide the delete action for those pages.
4. THE Admin_Panel SHALL support drag-and-drop or manual `sort_order` editing for page ordering, persisting the updated order to the CMS_Service within 2 seconds of the change.
5. WHEN an admin toggles a page's published status, THE Admin_Panel SHALL update the page record via the CMS_Service and display a success notification within 2 seconds confirming the status change.
6. IF a page save, delete, or status toggle request to the CMS_Service fails, THEN THE Admin_Panel SHALL display an error notification indicating the operation that failed and preserve the form data or previous state without data loss.
7. WHEN an admin deletes a non-system page, THE Admin_Panel SHALL display a confirmation dialog before sending the delete request to the CMS_Service.

### Requirement 13: Cache Invalidation

**User Story:** As a platform operator, I want changes to settings and pages to appear on the storefront promptly, so that updates are visible without waiting for the next deployment.

#### Acceptance Criteria

1. WHEN settings are updated via the Admin_Panel, THE Settings_Service SHALL update the `updated_at` timestamp on the `site_settings` row within the same database transaction as the content change.
2. WHILE the Storefront is serving cached settings data, THE Settings_Provider SHALL compare the cached `updated_at` timestamp against the server `updated_at` timestamp during each background revalidation request and replace the cached data if the server timestamp is newer.
3. WHEN the admin saves a page, THE CMS_Service SHALL update the `updated_at` timestamp on the `pages` row within the same database transaction as the content change.
4. WHEN a user navigates to a page route, THE Storefront SHALL serve the existing cached CMS page content within 100 milliseconds while initiating a background fetch for the latest version from the server.
5. IF a background revalidation request fails or does not complete within 5 seconds, THEN THE Storefront SHALL continue serving the previously cached content and retry on the next navigation to that route.
6. THE Storefront SHALL display updated settings and page content to users no later than 60 seconds after the change is saved in the Admin_Panel, assuming a user navigates to the relevant route within that period.

### Requirement 14: Hardcoded Brand Element Removal

**User Story:** As a developer, I want all hardcoded brand references removed from the codebase, so that the platform is fully configurable without code changes.

#### Acceptance Criteria

1. THE Storefront SHALL remove the hardcoded `"İlk Electronics"` alt text from the Header logo and use the locale-appropriate store name from the Settings_Provider.
2. THE Storefront SHALL remove the hardcoded phone number `+994 55 619 59 07`, email `info@ilkelectronics.com`, and address `Bakı, Azərbaycan` from the Footer and render values from the `contact` field in Settings_Provider.
3. THE Storefront SHALL remove the hardcoded social media URLs (`https://instagram.com`, `https://facebook.com`, `https://t.me`) from the Footer and render links from the `contact.social_links` setting.
4. THE Storefront SHALL remove the `VITE_STORE_NAME` environment variable dependency from the Footer and read the store name exclusively from the Settings_Provider.
5. THE Storefront SHALL remove all hardcoded policy page links (`/policies/delivery`, `/policies/returns`, `/policies/terms`) from the Footer and dynamically generate links from pages marked `show_in_footer`.
6. WHEN all hardcoded references are removed, THE Storefront SHALL render correctly with the default settings values (from Requirement 2, criterion 4) when no custom settings have been configured.
