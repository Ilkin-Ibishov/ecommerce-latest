# Requirements Document

> **Status: DEFERRED — revisit at ~8–10 stores.**
> No current demand. The platform uses an isolated model (one Supabase project + one Vercel deployment per store), which is safer and cheaper at low store counts and keeps each store's data physically separated. This shared multi-tenancy refactor front-loads significant effort and risk (touches every table, route, auth path, storage call, plus a risky migration of the live store) before the reach that justifies it exists. Park this spec until per-store onboarding cost/ops overhead becomes painful (~8–10 stores). When revisiting: the per-tenant SEO gap (server-rendered sitemap/robots/OG/JSON-LD scoped by `store_id`) must be added, and the automated provisioning script built for the isolated model can be reused for the `/platform/stores/provision` endpoint (R8.4).

## Introduction

Refactor the white-label e-commerce platform from a "one Supabase project + one Vercel deployment per store" isolation model to a shared-infrastructure model where multiple stores share a single Supabase database and a single Vercel deployment. Tenant isolation is achieved logically via `store_id` columns and PostgreSQL Row-Level Security (RLS) policies. The existing Control Plane (separate Supabase project) remains unchanged and continues to manage store registry, billing, and subscriptions externally.

## Glossary

- **Tenant**: A single store instance logically isolated within the shared database by its unique `store_id`
- **Store_Database**: The single shared Supabase PostgreSQL database hosting all tenant data
- **Control_Plane**: The separate Supabase project that manages store registry, billing, subscriptions, and platform-level operations (unchanged by this feature)
- **Tenant_Resolver**: The middleware component that determines which store a request belongs to based on domain, subdomain, or request headers
- **RLS_Policy**: A PostgreSQL Row-Level Security policy that restricts row access based on the authenticated tenant context
- **Store_Admin**: A user with the `admin` role scoped to a specific store
- **Storefront_User**: A customer who browses and purchases from a specific store
- **Tenant_Context**: The resolved `store_id` value propagated through the request lifecycle via Supabase RLS session variables
- **Domain_Mapping**: The association between a custom domain or subdomain and a specific `store_id`
- **Migration_Tool**: The automated script that transfers data from an existing single-tenant Supabase project into the shared Store_Database

## Requirements

### Requirement 1: Database Schema Tenant Isolation

**User Story:** As a platform operator, I want every data table to include a `store_id` column with RLS enforcement, so that tenants cannot access each other's data.

#### Acceptance Criteria

1. THE Store_Database SHALL include a non-nullable `store_id` column of type UUID on every tenant-scoped table (products, categories, category_translations, product_translations, product_images, product_specs, product_categories, orders, order_items, cart_items, comments, coupons, coupon_usages, wishlists, notifications, banners, brand_entries, pages, page_translations, site_settings, store_settings, users, otp_codes, otp_requests, audit_log)
2. THE Store_Database SHALL define a foreign key constraint from each `store_id` column referencing the `stores` table in the control-plane database
3. THE Store_Database SHALL enforce RLS policies on every tenant-scoped table such that SELECT, UPDATE, and DELETE operations only affect rows where `store_id` matches `current_setting('app.current_store_id')::uuid`, and INSERT operations only succeed when the row's `store_id` value matches `current_setting('app.current_store_id')::uuid`
4. WHEN a new database connection is assigned to serve a request, THE Store_Database SHALL set the tenant context via `set_config('app.current_store_id', store_id, true)` before any tenant-scoped query executes within that transaction
5. THE Store_Database SHALL include composite indexes on `(store_id, id)` for primary lookups on every tenant-scoped table, and composite indexes on `(store_id, created_at)` for time-ordered listing queries, `(store_id, slug)` on tables containing a `slug` column, and `(store_id, user_id)` on tables containing a `user_id` column
6. IF a query is executed without a `store_id` set in the session context or with a `store_id` that is NULL or not a valid UUID, THEN THE Store_Database SHALL return zero rows for SELECT operations and reject INSERT, UPDATE, and DELETE operations
7. THE Store_Database SHALL include a `stores` table containing at minimum: `id` (UUID, primary key), `slug` (text, unique), `domain` (text, nullable), `name` (text, non-nullable), `is_active` (boolean, default true), `created_at` (timestamptz), and `updated_at` (timestamptz) to serve as the tenant registry within the shared database
8. IF an INSERT or UPDATE operation specifies a `store_id` value that does not match the current session's `store_id`, THEN THE Store_Database SHALL reject the operation and return a permission-denied error

### Requirement 2: Tenant Resolution

**User Story:** As a platform operator, I want incoming requests to be resolved to the correct tenant automatically, so that all downstream queries are scoped correctly.

#### Acceptance Criteria

1. WHEN an HTTP request arrives with a `Host` header matching a configured custom domain, THE Tenant_Resolver SHALL resolve the corresponding `store_id` from the Domain_Mapping
2. WHEN an HTTP request arrives with a subdomain pattern `{slug}.{base_domain}`, THE Tenant_Resolver SHALL resolve the `store_id` by looking up the subdomain slug in the stores table
3. WHEN an HTTP request includes an `X-Store-Id` header (internal service-to-service calls), THE Tenant_Resolver SHALL validate that the header value is a valid UUID format and corresponds to an existing store in the stores table before using it as the resolved `store_id`
4. THE Tenant_Resolver SHALL evaluate resolution strategies in the following priority order: (1) `X-Store-Id` header, (2) custom domain via Domain_Mapping, (3) subdomain slug lookup; and SHALL use the first strategy that yields a match
5. IF the Tenant_Resolver cannot determine a valid `store_id` from the request, THEN THE Tenant_Resolver SHALL respond with HTTP 400 and a JSON body `{ "error": "Unable to resolve store" }`, regardless of which resolution strategies were available or attempted
6. IF the resolved `store_id` corresponds to an inactive store (`is_active = false`), THEN THE Tenant_Resolver SHALL respond with HTTP 503 and a JSON body `{ "error": "Store is currently unavailable" }`
7. WHEN a `store_id` is successfully resolved, THE Tenant_Resolver SHALL attach the value to the request object as `req.storeId` and propagate it to the Supabase client session via `set_config`
8. THE Tenant_Resolver SHALL cache Domain_Mapping lookups in memory with a TTL of 60 seconds and a maximum of 10,000 entries to avoid per-request database queries
9. IF the `X-Store-Id` header value is not a valid UUID or does not correspond to an existing store, THEN THE Tenant_Resolver SHALL respond with HTTP 400 and a JSON body `{ "error": "Invalid store identifier" }`

### Requirement 3: API Layer Tenant Scoping

**User Story:** As a developer, I want every API query to be automatically scoped to the resolved tenant, so that I cannot accidentally leak data across stores.

#### Acceptance Criteria

1. WHEN an HTTP request has a resolved `req.storeId`, THE API_Server SHALL create a per-request Supabase client and call the PostgreSQL function `set_tenant_context(store_id)` (which executes `set_config('app.current_store_id', $1, true)`) before the client is used by any route handler
2. IF the `set_tenant_context` call fails or returns an error, THEN THE API_Server SHALL respond with HTTP 500 and a JSON body containing an error message indicating tenant context could not be established, and SHALL fail immediately at the first database operation without executing any subsequent database operations for that request
3. WHEN any route handler performs a database read, THE API_Server SHALL rely on RLS policies to enforce tenant scoping rather than manually appending `.eq('store_id', storeId)` filters
4. WHEN any route handler performs a database write (INSERT, UPDATE, or DELETE), THE API_Server SHALL include the resolved `store_id` in inserted rows and rely on RLS policies to restrict UPDATE and DELETE operations to rows matching the current tenant context
5. IF a route handler attempts to query the `stores` table directly, THEN THE API_Server SHALL respond with HTTP 403 and a JSON body containing an error message indicating that direct access to the stores table is forbidden (reserved for Tenant_Resolver and platform operations)
6. WHILE a request is routed to a platform-scoped endpoint (under `/platform/`), THE API_Server SHALL bypass per-tenant client creation and use the service-role client without tenant context, since platform operations are cross-tenant by design

### Requirement 4: Authentication and User Scoping

**User Story:** As a store admin, I want my login to be scoped to my store only, so that I cannot see or manage another store's data.

#### Acceptance Criteria

1. THE Store_Database SHALL include a `store_id` column on the `users` table linking each user to exactly one tenant
2. WHEN a user authenticates via OTP, THE Auth_System SHALL verify that the user's `store_id` matches the resolved tenant context of the request (i.e., `req.storeId` set by the Tenant_Resolver middleware)
3. IF a user attempts to authenticate against a store they do not belong to, THEN THE Auth_System SHALL return HTTP 403 with `{ "error": "User does not belong to this store" }` and SHALL NOT issue session tokens
4. WHEN a new user registers (via first OTP verification where no existing `users` row matches the provided phone number), THE Auth_System SHALL assign the resolved `store_id` to the new user record before issuing session tokens
5. IF user record creation fails during registration due to a database constraint or other technical error, THEN THE Auth_System SHALL fail the entire registration process, SHALL NOT issue session tokens, and SHALL return an error response
6. THE Auth_System SHALL include a `store_id` claim (key: `store_id`) in the JWT access token payload so that RLS policies can reference it without an additional lookup
7. WHEN a Store_Admin accesses admin routes, THE API_Server SHALL verify that the admin's `store_id` matches the resolved tenant context
8. IF a Store_Admin's `store_id` does not match the resolved tenant context when accessing admin routes, THEN THE API_Server SHALL return HTTP 403 with an error indicating the admin does not belong to the requested store and SHALL NOT execute the route handler

### Requirement 5: Storage and Asset Isolation

**User Story:** As a store admin, I want my uploaded product images and branding assets to be isolated from other stores, so that assets cannot be shared or overwritten across tenants.

#### Acceptance Criteria

1. THE Storage_System SHALL namespace all file uploads under a path prefix of `{store_id}/` within Supabase Storage buckets
2. WHEN a Store_Admin uploads a product image, THE Storage_System SHALL store it at `{store_id}/products/{generated_filename}` where the generated filename consists of a Unix timestamp, a hyphen, and a random alphanumeric suffix of at least 8 characters followed by the file extension
3. WHEN a Store_Admin uploads a logo or favicon, THE Storage_System SHALL store it at `{store_id}/branding/{generated_filename}` where the generated filename consists of a Unix timestamp, a hyphen, and a random alphanumeric suffix of at least 8 characters followed by the file extension
4. IF an upload's generated filename does not meet the minimum 8-character random alphanumeric suffix requirement, THEN THE Storage_System SHALL reject the upload even if the path is correctly namespaced under the tenant's `store_id` prefix
5. THE Storage_System SHALL enforce Supabase Storage RLS policies that restrict write access and read access for non-public assets to the owning tenant only
6. WHEN the storefront serves public assets (published product images, logos, favicons), THE Storage_System SHALL allow unauthenticated read access to files within the `{store_id}/` prefix only when the request's resolved tenant matches that `store_id`, and SHALL NOT serve a tenant's public assets to requests resolved to a different tenant
7. IF a request attempts to read or write a storage path with a `store_id` prefix that does not match the authenticated user's tenant or the resolved storefront tenant, THEN THE Storage_System SHALL deny the operation and return HTTP 403
8. WHEN a Store_Admin uploads a file, THE Storage_System SHALL derive the `store_id` path prefix from the server-side resolved tenant context and SHALL NOT accept a client-supplied storage path prefix

### Requirement 6: Storefront Domain Routing

**User Story:** As a store owner, I want customers to access my store via my custom domain or subdomain, so that the storefront renders my branding and products.

#### Acceptance Criteria

1. WHEN a storefront request arrives, THE Storefront_App SHALL use the resolved `store_id` to fetch the corresponding `site_settings` and `store_settings` records from the tenant-scoped API
2. THE Storefront_App SHALL render the correct store name, logo, favicon, colors, fonts, and footer text based on the resolved tenant's `site_settings` JSON fields, and SHALL NOT render any branding elements until the tenant's `site_settings` have been successfully fetched
3. WHEN the Storefront_App fetches products, categories, or pages, THE Storefront_App SHALL rely on the tenant-scoped API responses (already filtered by RLS via the Tenant_Resolver)
4. THE Storefront_App SHALL support both custom domains (e.g., `shop.example.com`) and platform subdomains (e.g., `mystore.platform.az`) resolving to the same tenant via the Tenant_Resolver priority order
5. WHEN a storefront request arrives for an unregistered domain (Tenant_Resolver returns 400), THE Storefront_App SHALL display an HTTP 404 page immediately with a message indicating the store was not found, without attempting to render any branding elements
6. THE Storefront_App SHALL preserve the existing locale routing pattern (`/az/`, `/ru/`, `/en/`) per tenant, using the same `useI18n()` hook and `t(key)` translation function

### Requirement 7: Data Migration Strategy

**User Story:** As a platform operator, I want to migrate the existing single-tenant store data into the shared database without data loss, so that current customers experience no disruption.

#### Acceptance Criteria

1. THE Migration_Tool SHALL export all rows from every tenant-scoped table in the existing single-tenant Supabase project and re-import them into the shared Store_Database with the specified `store_id` assigned to every row, processing tables in foreign-key dependency order to prevent referential integrity violations, and SHALL consider the migration successful only when every row from the source has been transferred to the target
2. THE Migration_Tool SHALL preserve all existing primary key UUIDs during migration to maintain referential integrity
3. THE Migration_Tool SHALL migrate Supabase Storage objects from the single-tenant bucket into the `{store_id}/` namespaced path in the shared bucket, preserving original filenames and directory structure beneath the namespace prefix
4. WHEN the migration completes, THE Migration_Tool SHALL produce a verification report listing: row counts per table (source vs. target), a foreign-key integrity check confirming all references resolve within the migrated dataset, and a storage object count comparison (source bucket vs. `{store_id}/` prefix in shared bucket)
5. IF a migration encounters a conflict (duplicate UUID already present in the target table), THEN THE Migration_Tool SHALL log the conflict including table name, conflicting UUID, and source row timestamp, and skip the conflicting row without halting the entire migration
6. THE Migration_Tool SHALL support a dry-run mode that performs schema compatibility checks (source columns map to target columns), validates that all foreign-key references within the source dataset will resolve after migration, verifies storage bucket accessibility, and reports the estimated row and object counts — without writing to the target database or shared bucket
7. THE Migration_Tool SHALL be idempotent such that re-running the migration for the same store SHALL always skip rows whose primary key already exists in the target table and SHALL always skip storage objects whose path already exists in the shared bucket, and SHALL under no circumstances create duplicates or overwrite existing data
8. IF the migration fails after partially writing rows to the target database, THEN THE Migration_Tool SHALL record the last successfully migrated table and row offset in a checkpoint file so that a subsequent run resumes from the point of failure rather than reprocessing already-migrated data
9. WHEN the migration for a store completes with zero discrepancies in the verification report, THE Migration_Tool SHALL mark the migration as successful in the checkpoint file and output a summary indicating total rows migrated, total storage objects transferred, and elapsed wall-clock time

### Requirement 8: Control Plane Integration

**User Story:** As a super-admin, I want the Control Plane to continue managing store lifecycle (create, suspend, disable) against the shared infrastructure, so that existing workflows remain functional.

#### Acceptance Criteria

1. WHEN the Control_Plane creates a new store via `POST /platform/stores`, THE API_Server SHALL insert a corresponding row into the Control_Plane `stores` table with `platform_status` set to `onboarding` and `subscription_status` set to `trialing`
2. WHEN the Control_Plane suspends or disables a store via the respective lifecycle endpoint, THE API_Server SHALL update the `platform_status` field in the `stores` table to `suspended` or `disabled` and record a `suspended_at` timestamp when suspending
3. WHEN the Control_Plane reactivates a store via `POST /platform/stores/:id/reactivate`, THE API_Server SHALL set `platform_status` to `active` in the `stores` table only if the current status is `suspended`, and SHALL return a transition error for any other current status including `disabled` (reactivation is restricted to suspended stores only)
4. IF the Control_Plane sends a store creation request with a `name` that matches an existing store name (case-insensitive), THEN THE API_Server SHALL reject the request with HTTP 409 and an error message indicating the name collision
5. THE API_Server SHALL pull `platform_status` from the Control_Plane using the `platformStatus` middleware (pull-with-cache pattern) with a cache TTL of 60 seconds, scoped to the individual store instance, and SHALL fail-safe to `active` when the Control_Plane is unreachable and no cached value exists
6. WHEN the Control_Plane queries store metrics, THE API_Server SHALL return metrics from the `store_metrics_cache` table scoped to the requested `store_id` only, including `order_count`, `revenue_total`, `traffic_count`, and `quota_usage` fields

### Requirement 9: Store Settings and Branding per Tenant

**User Story:** As a store admin, I want my store's branding and settings to be independent from other stores, so that each storefront has a unique identity.

#### Acceptance Criteria

1. THE Store_Database SHALL scope the `site_settings` table by `store_id`, allowing each tenant to maintain independent values for `colors` (JSON with keys: primary, secondary, accent, background, text, muted), `fonts` (JSON with keys: heading, body), `logo_url`, `favicon_url`, `contact` (JSON), `working_hours` (JSON), `footer_text` (JSON), and `store_name` (JSON with keys: az, ru, en)
2. THE Store_Database SHALL scope the `store_settings` table by `store_id` with a composite primary key of `(store_id, key)`, where `key` is a non-empty string of at most 255 characters and `value` is a non-empty string of at most 10000 characters
3. WHEN a Store_Admin updates site settings, THE API_Server SHALL only modify the `site_settings` row matching the admin's resolved `store_id`, and SHALL reject the request with a 403 error if the admin's resolved `store_id` does not match the target row's `store_id`
4. WHEN the storefront loads, THE Storefront_App SHALL fetch `site_settings` for the resolved tenant's `store_id` and apply the branding (colors, fonts, logo) to the page
5. THE Store_Database SHALL seed default `site_settings` and `store_settings` rows when a new tenant is provisioned, populating `site_settings` with empty locale objects for `store_name`, `working_hours`, and `footer_text`, empty color and font values, and null for `logo_url` and `favicon_url`
6. WHEN a Store_Admin updates the `logo_url` or `favicon_url` in site settings, THE API_Server SHALL validate that the referenced storage path begins with the admin's tenant `store_id` prefix, and SHALL reject the update with a 403 error if the path belongs to a different tenant
7. IF the `site_settings` row for the resolved tenant does not exist in the database, THEN THE API_Server SHALL return a default settings object with empty locale objects and null asset URLs rather than returning an error

### Requirement 10: Performance and Noisy-Neighbor Protection

**User Story:** As a platform operator, I want to ensure that one store's traffic surge does not degrade the experience for other stores, so that all tenants receive consistent performance.

#### Acceptance Criteria

1. THE Store_Database SHALL use composite indexes `(store_id, <column>)` on all high-traffic query patterns to ensure index-only scans per tenant
2. THE API_Server SHALL implement per-tenant rate limiting keyed by `store_id` on storefront read endpoints, with a configurable limit defaulting to 300 requests per minute per `store_id`
3. WHEN a tenant exceeds its configured rate limit, THE API_Server SHALL respond with HTTP 429, include a `Retry-After` header indicating the number of seconds until the window resets, and reject further requests from that `store_id` until the current window expires
4. THE Store_Database SHALL use connection pooling (Supabase PgBouncer) in transaction mode to prevent a single tenant from exhausting database connections
5. THE API_Server SHALL log the `store_id` on every inbound request to enable per-tenant latency and error-rate monitoring
6. WHEN a database query initiated by the API_Server exceeds 5 seconds of execution time, THE API_Server SHALL cancel the query and return HTTP 504 with a response body containing an error message indicating a query timeout
7. THE Store_Database SHALL enforce a `statement_timeout` of 10 seconds at the session level, set alongside the tenant context at connection acquisition, to terminate any query exceeding that duration regardless of application-level cancellation
8. IF the Store_Database connection pool is exhausted for a given tenant, THEN THE API_Server SHALL reject new requests from that tenant with HTTP 503 and a `Retry-After` header set to 5 seconds, without impacting connection availability for other tenants; this HTTP 503 response applies only to the connection-pool-exhausted scenario and not to other database connection failures
