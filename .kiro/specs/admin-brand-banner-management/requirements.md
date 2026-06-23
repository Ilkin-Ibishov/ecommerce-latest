# Requirements Document

## Introduction

This feature allows store administrators to manage the brand logo marquee banner on the homepage. Currently, the brand logos are hardcoded in the frontend (`BRAND_LOGOS` array with 18 SVG data URIs). This feature moves brand data to the database, provides admin CRUD operations (add, remove, reorder brands), and adds a toggle to enable/disable the entire brand banner section. The storefront will fetch brand data dynamically instead of using the hardcoded array.

## Glossary

- **Brand_Banner**: The auto-scrolling marquee section on the homepage that displays brand logos linking to filtered product pages.
- **Brand_Entry**: A single brand item consisting of a name, logo image URL, display order, and active status.
- **Admin_Panel**: The store administration interface accessible at `/admin/` routes, used by store administrators.
- **Storefront**: The customer-facing React SPA that renders the homepage and product pages.
- **Brand_API**: The Express API routes under `/api/admin/brands` that provide CRUD operations for brand entries.
- **Settings_API**: The existing Express API route at `/api/admin/settings` that manages key-value store settings.
- **Brand_Banner_Toggle**: A store setting (`brand_banner_enabled`) that controls whether the brand banner section is visible on the storefront.

## Requirements

### Requirement 1: Brand Banner Visibility Toggle

**User Story:** As a store admin, I want to enable or disable the brand banner on the homepage, so that I can control whether the marquee is shown to customers without deleting brand data.

#### Acceptance Criteria

1. THE Settings_API SHALL store a `brand_banner_enabled` setting with value `"true"` or `"false"`.
2. WHEN the admin updates the `brand_banner_enabled` setting with a valid value (`"true"` or `"false"`) via the Settings_API, THE Settings_API SHALL persist the new value and log the change to the audit trail.
3. WHEN the Storefront loads the homepage, THE Storefront SHALL fetch the `brand_banner_enabled` setting value.
4. WHILE the `brand_banner_enabled` setting value is `"false"`, THE Storefront SHALL hide the Brand_Banner section entirely, rendering no marquee markup in the DOM.
5. WHILE the `brand_banner_enabled` setting value is `"true"` or missing (default), THE Storefront SHALL display the Brand_Banner section.
6. THE Admin_Panel SHALL display a toggle switch for the Brand_Banner_Toggle on the brand management page that reflects the current persisted value and calls the Settings_API to update the setting when toggled.
7. IF the admin sends an update to `brand_banner_enabled` with a value other than `"true"` or `"false"`, THEN THE Settings_API SHALL return a 400 validation error indicating the accepted values.
8. IF the Storefront fails to fetch the `brand_banner_enabled` setting, THEN THE Storefront SHALL treat the value as `"true"` (default) and display the Brand_Banner section.
9. WHILE the `brand_banner_enabled` setting fetch is in progress, THE Storefront SHALL display the Brand_Banner section (optimistic default), then hide it if the fetched value is `"false"`.

### Requirement 2: Brand Entry Data Storage

**User Story:** As a store admin, I want brand entries stored in the database, so that I can manage them without code deployments.

#### Acceptance Criteria

1. THE database SHALL store Brand_Entry records with fields: `id` (UUID), `name` (text, required, maximum 100 characters), `logo_url` (text, required, maximum 100,000 characters), `sort_order` (integer, range 0 to 999, default 0), `is_active` (boolean, default true), `created_at` (timestamp), and `updated_at` (timestamp).
2. THE database SHALL enforce a case-insensitive unique constraint on the `name` field of Brand_Entry records.
3. WHEN the database is first set up, THE system SHALL seed the 18 existing brand entries from the current `BRAND_LOGOS` array as the default dataset, assigning `sort_order` values 0 through 17 in array order.
4. THE Brand_Entry `logo_url` field SHALL accept values matching either a data URI with `data:image/svg+xml` prefix or an external URL with `https://` prefix.
5. WHEN a Brand_Entry record is updated, THE database SHALL automatically set the `updated_at` field to the current timestamp.

### Requirement 3: Admin CRUD Operations for Brand Entries

**User Story:** As a store admin, I want to add, edit, and remove brand entries, so that I can keep the brand showcase up to date.

#### Acceptance Criteria

1. WHEN the admin sends a GET request to the Brand_API list endpoint, THE Brand_API SHALL return all Brand_Entry records ordered by `sort_order` ascending.
2. WHEN the admin sends a POST request with a valid name and logo_url, THE Brand_API SHALL create a new Brand_Entry with `sort_order` set to one greater than the current maximum `sort_order` value (or 0 if no entries exist) and return the created record ID.
3. WHEN the admin sends a PATCH request with updated fields for an existing Brand_Entry, THE Brand_API SHALL update only the allowed fields (`name`, `logo_url`, `sort_order`, `is_active`) and log the change to the audit trail.
4. WHEN the admin sends a DELETE request for an existing Brand_Entry, THE Brand_API SHALL remove the record and log the deletion to the audit trail.
5. IF the admin sends a POST request with a name that already exists (case-insensitive match), THEN THE Brand_API SHALL return a 409 conflict error.
6. IF the admin sends a PATCH request with a `name` that matches another existing Brand_Entry (case-insensitive), THEN THE Brand_API SHALL return a 409 conflict error.
6. IF the admin sends a request with a missing `name`, a `name` exceeding 100 characters, a missing `logo_url`, or a `logo_url` that is neither a valid data URI nor an HTTPS URL, THEN THE Brand_API SHALL return a 400 validation error.
7. THE Brand_API SHALL require admin authentication via the `requireAdmin` middleware for all endpoints.
8. THE Brand_API SHALL validate request bodies with Zod schemas via the `validate` middleware.
9. IF the admin sends a PATCH or DELETE request referencing a Brand_Entry ID that does not exist, THEN THE Brand_API SHALL return a 404 error.

### Requirement 4: Brand Entry Reordering

**User Story:** As a store admin, I want to reorder brand entries, so that I can control the display sequence of the marquee.

#### Acceptance Criteria

1. WHEN the admin sends a PATCH request to the Brand_API reorder endpoint with an ordered array containing the IDs of all existing Brand_Entry records, THE Brand_API SHALL update the `sort_order` field of each Brand_Entry to its zero-based index position in the provided array.
2. IF the reorder payload is not a non-empty array of valid UUID strings, or contains duplicate IDs, THEN THE Brand_API SHALL return a 400 validation error indicating the malformed field (fail-fast: format validation occurs before existence checks).
3. IF the reorder payload contains IDs that do not exist in the database, THEN THE Brand_API SHALL return a 400 error indicating the invalid IDs.
4. IF the reorder payload does not include all existing Brand_Entry IDs, THEN THE Brand_API SHALL return a 400 error indicating that a complete ordered list is required.
5. WHEN the admin reorders brand entries via the Admin_Panel, THE Admin_Panel SHALL provide a drag-and-drop interface for reordering and persist the new order only after the admin confirms by clicking a save action.

### Requirement 5: Storefront Brand Banner Display

**User Story:** As a customer, I want to see brand logos on the homepage that link to brand-filtered product pages, so that I can quickly browse products by brand.

#### Acceptance Criteria

1. WHEN the homepage loads, THE Storefront SHALL fetch active Brand_Entry records from a public API endpoint ordered by `sort_order` ascending, completing the request within 3 seconds.
2. WHEN the Storefront receives active Brand_Entry records, THE Storefront SHALL render them in an auto-scrolling marquee with grayscale logo images that transition to full color on hover, each linked to `/products?brand={name}`.
3. WHILE there are zero active Brand_Entry records and the Brand_Banner is enabled, THE Storefront SHALL hide the Brand_Banner section entirely, rendering no marquee container in the DOM.
4. THE public brands API endpoint SHALL NOT require authentication.
5. WHILE the `brand_banner_enabled` setting is `"false"`, THE Storefront SHALL NOT render the Brand_Banner section regardless of whether active Brand_Entry records exist (setting takes precedence over data).
5. THE Storefront SHALL display each Brand_Entry logo using the `logo_url` field as the image source.
6. THE Storefront SHALL use the Brand_Entry `name` field as the image `alt` text and the link `title` attribute.
7. IF the public brands API request fails or times out, THEN THE Storefront SHALL hide the Brand_Banner section and SHALL NOT display an error message to the customer.
8. IF a Brand_Entry `logo_url` fails to load, THEN THE Storefront SHALL hide that individual Brand_Entry from the marquee rather than displaying a broken image.

### Requirement 6: Admin Panel Brand Management UI

**User Story:** As a store admin, I want a dedicated page in the admin panel to manage brands, so that I can easily add, edit, reorder, and remove brand entries.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide a brand management page accessible at the `/admin/brands` route.
2. THE Admin_Panel brand management page SHALL display all Brand_Entry records in a sortable list with columns for logo preview, name, status, and actions.
3. THE Admin_Panel SHALL provide a form to add a new Brand_Entry with fields for name and logo URL.
4. THE Admin_Panel SHALL provide inline toggle switches to activate or deactivate individual Brand_Entry records.
5. THE Admin_Panel SHALL provide a delete button for each Brand_Entry with a confirmation dialog.
6. THE Admin_Panel SHALL display the Brand_Banner_Toggle at the top of the brand management page.
7. THE Admin_Panel brand management page SHALL use the existing `useAdminList` hook and `DataTable` component patterns.
