# Implementation Plan: Admin Brand Banner Management

## Overview

Migrate the hardcoded `BRAND_LOGOS` array to a database-backed admin-managed system. Implementation proceeds bottom-up: database schema → API routes → frontend admin page → storefront integration.

## Tasks

- [x] 1. Database schema and seed data
  - [x] 1.1 Create `brand_entries` table migration
    - Create table with columns: `id` (UUID PK), `name` (TEXT NOT NULL), `logo_url` (TEXT NOT NULL), `sort_order` (INTEGER NOT NULL DEFAULT 0, CHECK 0–999), `is_active` (BOOLEAN NOT NULL DEFAULT true), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ)
    - Add case-insensitive unique index on `LOWER(name)`
    - Add `updated_at` trigger reusing existing `update_updated_at_column()` function
    - Enable RLS with public read policy for active entries
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 1.2 Seed existing brand data and `brand_banner_enabled` setting
    - Insert 18 brand entries from existing `brand-icons.ts` with sort_order 0–17
    - Insert `brand_banner_enabled = 'true'` into `store_settings` (ON CONFLICT DO NOTHING)
    - _Requirements: 2.3, 1.1_

- [x] 2. Admin API routes — Zod schemas and CRUD
  - [x] 2.1 Add Zod validation schemas for brand operations
    - Add `CreateBrandSchema`, `UpdateBrandSchema`, `ReorderBrandsSchema` to `artifacts/api-server/src/routes/admin/schemas.ts`
    - `logo_url` regex: `^(data:image\/svg\+xml|https:\/\/)`
    - `name`: 1–100 chars; `sort_order`: int 0–999; `ids`: non-empty unique UUID array
    - _Requirements: 2.4, 3.6, 3.8, 4.2_

  - [x] 2.2 Implement admin brand CRUD route file
    - Create `artifacts/api-server/src/routes/admin/brands-management.ts`
    - GET `/admin/brands` — list all ordered by sort_order asc
    - POST `/admin/brands` — create with auto sort_order (max+1 or 0), `writeAudit()`, 409 on duplicate name (case-insensitive)
    - PATCH `/admin/brands/reorder` — bulk reorder (registered BEFORE `/:id`), validate completeness
    - PATCH `/admin/brands/:id` — partial update, 409 on name conflict with OTHER entries (case-insensitive), 404 if missing, `writeAudit()`
    - DELETE `/admin/brands/:id` — remove, 404 if missing, `writeAudit()`
    - Apply `requireAdmin` middleware to all; `validate(schema)` on POST/PATCH
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 4.1, 4.3, 4.4_

  - [x] 2.3 Add `brand_banner_enabled` validation to Settings_API
    - In the existing settings update handler, add per-key validation: if key is `brand_banner_enabled`, value must be `"true"` or `"false"`, else return 400
    - Ensure `writeAudit()` is called on successful update (verify existing behavior)
    - _Requirements: 1.2, 1.7_

  - [x] 2.4 Register brand admin routes in admin router
    - Import and mount in `artifacts/api-server/src/routes/admin/index.ts`
    - _Requirements: 3.7_

  - [x] 2.5 Write property tests for brand API validation and logic
    - **Property 1: Settings Validation Rejects Invalid Values**
    - **Property 2: Case-Insensitive Name Uniqueness** (both CREATE and UPDATE)
    - **Property 3: Brand List Ordering Invariant**
    - **Property 4: Auto-Increment Sort Order on Creation**
    - **Property 6: Request Body Validation**
    - **Validates: Requirements 1.7, 2.2, 3.1, 3.2, 3.5, 3.6, 3.8**

  - [x] 2.6 Write property tests for partial update and reorder
    - **Property 5: Partial Update Field Isolation**
    - **Property 7: Reorder Assignment Correctness**
    - **Property 8: Reorder Payload Validation**
    - **Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4**

- [x] 3. Public brands API endpoint
  - [x] 3.1 Create public brands route
    - Create `artifacts/api-server/src/routes/brands-public.ts`
    - GET `/api/brands` — no auth, returns active brand entries ordered by sort_order asc
    - Also return `brand_banner_enabled` setting value in response (avoids second fetch from storefront)
    - Register in main app router (public routes section)
    - _Requirements: 5.1, 5.4, 1.3_

  - [x] 3.2 Write unit tests for public brands endpoint
    - Test: returns only active entries ordered by sort_order
    - Test: returns empty array when no active brands
    - Test: no auth required
    - Test: includes `brand_banner_enabled` value in response
    - _Requirements: 5.1, 5.4_

- [x] 4. Admin panel — Brand management page
  - [x] 4.1 Add i18n keys for brand management page
    - Add translation keys to `az.ts`, `ru.ts`, `en.ts` for: page title, column headers (Logo, Name, Status, Actions), form labels (Brand Name, Logo URL), buttons (Add Brand, Save Order, Delete), toggle label (Show brand banner), empty state, confirmation dialog text, error messages (name exists, invalid URL)
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.2 Create BrandsPage component with DataTable
    - Create `artifacts/store/src/pages/admin/BrandsPage.tsx`
    - Use `useAdminList` hook + `DataTable` + `Pagination` + `TableEmptyState`
    - Columns: logo preview (small img), name, status toggle (is_active), actions (edit/delete)
    - Brand banner toggle at top (fetches/updates `brand_banner_enabled` via settings API)
    - All UI strings via `t()` i18n
    - _Requirements: 6.1, 6.2, 6.4, 6.6, 6.7_

  - [x] 4.3 Implement add/edit brand form
    - Add dialog form with name + logo_url fields
    - Validate inputs client-side before submission
    - Handle 409 conflict error (show "name already exists" message)
    - Handle 400 validation errors (show field-specific messages)
    - _Requirements: 6.3, 3.5, 3.6_

  - [x] 4.4 Implement drag-and-drop reorder with save action
    - Add drag-and-drop reorder UI (using `@dnd-kit/sortable` or manual approach)
    - Persist new order only on explicit save button click
    - Call PATCH `/admin/brands/reorder` with full ordered ID array
    - _Requirements: 4.5, 6.2_

  - [x] 4.5 Implement delete with confirmation dialog
    - Add delete button per row with `useConfirm()` + `<ConfirmDialog>`
    - Call DELETE `/admin/brands/:id` on confirmation
    - Refresh list after deletion
    - _Requirements: 6.5, 3.4_

  - [x] 4.6 Register admin brands route in App.tsx and sidebar
    - Add `/admin/brands` route pointing to `BrandsPage` in `App.tsx`
    - Add "Brands" navigation link in admin sidebar component (identify correct file: `AdminLayout.tsx` or sidebar)
    - _Requirements: 6.1_

- [x] 5. Storefront — Dynamic brand banner
  - [x] 5.1 Update HomePage to fetch brands dynamically
    - Remove `import { BRAND_LOGOS } from "@/lib/brand-icons"` from HomePage
    - Fetch active brands + `brand_banner_enabled` from public API (`GET /api/brands`)
    - Conditionally render marquee: hidden when setting is `"false"`, hidden when no active brands, hidden on fetch error
    - Show banner optimistically while fetch is in progress (default visible); hide if fetched value is `"false"`
    - Setting takes precedence: if disabled, don't render even if brands exist
    - _Requirements: 1.3, 1.4, 1.5, 1.8, 1.9, 5.3, 5.5, 5.7_

  - [x] 5.2 Update marquee rendering with dynamic brand data
    - Each brand: `<Link href="/{locale}/products?brand={name}" title="{name}"><img src="{logo_url}" alt="{name}" /></Link>`
    - Maintain existing grayscale → color hover styling and auto-scroll marquee animation
    - Handle individual image load errors via `onError` — hide that entry (don't show broken img)
    - _Requirements: 5.2, 5.5, 5.6, 5.8_

  - [x] 5.3 Delete `brand-icons.ts` file
    - Remove `artifacts/store/src/lib/brand-icons.ts` — no longer needed, data lives in DB
    - Verify no other imports reference this file
    - _Cleanup task_

  - [x] 5.4 Write property test for marquee rendering correctness
    - **Property 9: Marquee Rendering Correctness**
    - For any non-empty brand array: each link has correct href, title, img alt, img src
    - **Validates: Requirements 5.2, 5.5, 5.6**

- [x] 6. Final verification
  - [x] 6.1 Run full test suite and typecheck
    - `pnpm run typecheck` — must pass with zero errors
    - `pnpm run test` — all existing + new tests must pass
    - Verify no i18n-consistency test failures (all 3 locales have new keys)
    - _Verification_

## Notes

- All tasks are mandatory (no optional markers) — property tests are correctness guarantees
- Each task references specific requirements for traceability
- The `reorder` route MUST be registered before `/:id` param route to avoid shadowing
- All admin strings must use `t()` for i18n (3 locales: az/ru/en) — task 4.1 ensures keys exist before UI
- Audit logging uses fire-and-forget `writeAudit()` pattern
- Task 2.3 is new: validates the `brand_banner_enabled` setting key specifically (R1.7)
- Task 4.1 is new: ensures i18n keys exist before BrandsPage is built (prevents test failures)
- Task 5.3 is new: cleans up the now-obsolete `brand-icons.ts` file

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "3.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.6"] },
    { "id": 6, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2", "5.3"] },
    { "id": 9, "tasks": ["5.4", "6.1"] }
  ]
}
```
