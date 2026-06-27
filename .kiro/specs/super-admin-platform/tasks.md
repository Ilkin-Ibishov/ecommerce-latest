# Implementation Plan: Super Admin Platform

## Overview

This plan implements the Control_Plane + physically-isolated-per-store-database model from the design. It is sequenced to mirror the design's **phased delivery** so each phase is independently shippable and the user can stop after any phase:

- **Phase 0 — Foundations:** Control_Plane application with its own database (`getControlPlaneSupabase()` + generated `ControlPlaneDatabase` type), Super_Admin auth + MFA + sessions, the Store_Registry + lifecycle, and the store-side platform-status self-gate (pull-with-cache + fail-safe-to-active). Properties 1, 2, 3, 4, 11, 12, 13, 28.
- **Phase 1 — Operations:** Cross-store dashboard + aggregate-only metrics polling, suspend/reactivate (Control_Plane sets status, the Store enforces), and platform notifications. Properties 5, 6, 7, 8, 9, 10, 14, 15, 17, 18, 19.
- **Phase 2 — Monetization:** Subscription plans, invoices + manual billing with optional automation, subscription-status updates, and platform analytics. Properties 16, 21, 22, 23, 24, 31.
- **Phase 3 — Support & hardening:** Impersonation/support access, offboarding/retention, plan-based quota limits, and email-delivery hardening, plus the cross-surface locale resolver. Properties 20, 25, 26, 27, 29, 30.

Implementation language is **TypeScript** (Express 5 `@workspace/api-server`, React 19 `@workspace/store`). All control-plane routes live under `routes/platform/*` and use `getControlPlaneSupabase()` only — never a store client. Pure logic is extracted into `lib/platform/*`, `lib/store-hooks/*`, `lib/billing/*`, and `lib/notifications/*` so the 31 correctness properties can be unit/property tested without a live DB, mirroring `artifacts/api-server/tests/audit-logging.property.test.ts` (vitest + fast-check, ≥100 runs, tagged `// Feature: super-admin-platform, Property N: ...`).

**Out-of-band (not coding tasks):** Standing up each leased Store instance — provisioning its separate Supabase project, deploying it, and delivering its raw `Per_Store_Credential` secret to it — is **manual / out-of-band** (R5.10). Store creation in the Control_Plane only records the Store_Registry entry (instance URL, metrics endpoint URL, credential hash/reference, status).

---

## Tasks

### Phase 0 — Foundations

- [x] 1. Establish the Control_Plane database, client, and generated types
  - [x] 1.1 Add the Control_Plane Supabase client and env wiring
    - Create `artifacts/api-server/src/lib/control-plane-supabase.ts` exporting `getControlPlaneSupabase(): SupabaseClient<ControlPlaneDatabase>` built from `CONTROL_PLANE_SUPABASE_URL` / `CONTROL_PLANE_SUPABASE_SERVICE_KEY` (auth: no autoRefresh, no persistSession)
    - Extend `lib/env.ts` resolution for the new control-plane vars; document them in `.env` example
    - Leave existing `getSupabase()/getAdminSupabase()` untouched; this client is the only one `routes/platform/*` may use
    - _Requirements: 9.1, 9.7, 9.8_
  - [x] 1.2 Add the generated `ControlPlaneDatabase` type
    - Add a separate `ControlPlaneDatabase` export in `@workspace/supabase-types` (distinct from the store `Database`)
    - Add a typegen script entry targeting the control-plane project
    - _Requirements: 9.7, 9.8_
  - [x] 1.3 Create the Phase 0 Control_Plane schema migrations
    - Create `stores` (Store_Registry: name, name_normalized unique, instance_url, metrics_endpoint_url, per_store_credential_hash, owner_email/name, locale, platform_status FSM default `onboarding`, subscription_status default `trialing`, suspended_at, status_before_suspend, timestamps), `platform_admins`, `control_plane_sessions`, and the Control_Plane `audit_log` (with `scope` + `store_id`)
    - Enable RLS and trigger-managed `updated_at` per house conventions; apply to the control-plane project only
    - _Requirements: 1.1, 5.1, 9.7, 9.8, 11.1, 11.2_

- [x] 2. Implement Super_Admin authorization, MFA, sessions, and control-plane audit
  - [x] 2.1 Implement the authorization decision function
    - Create `lib/platform/authorize.ts` — pure `authorizeSuperAdmin(credential)` returning grant/deny: grant iff present + Super_Admin tier + unexpired + not revoked; super-admin also satisfies store-admin-tier checks; never grants direct store-DB access
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [x]* 2.2 Write property test for the authorization decision
    - **Property 1: Server-side super-admin authorization**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 8.7**
  - [x] 2.3 Implement MFA + control-plane session validity logic
    - Create `lib/platform/session.ts` — pure helpers: enrollment-verify outcome (success enables MFA, failure leaves unchanged), and session validity given start/last-seen vs 8h lifetime + 15m idle bounds returning grant / lifetime_expiry / idle_timeout
    - _Requirements: 17.3, 17.4, 17.5, 17.7_
  - [x]* 2.4 Write property test for MFA + session validity
    - **Property 28: MFA enrollment and control-plane session validity**
    - **Validates: Requirements 17.3, 17.4, 17.5, 17.7**
  - [x] 2.5 Implement `requireSuperAdmin` and `requireServiceCredential` middleware
    - Add `middlewares/requireSuperAdmin.ts`: verify Supabase user against `platform_admins`, check `control_plane_sessions` MFA-satisfied + lifetime/idle via `lib/platform/session.ts`, attach `req.superAdmin`; on any failure → `403` + denial audit
    - Add `middlewares/requireServiceCredential.ts`: constant-time compare of a header secret vs `PLATFORM_SCHEDULER_SECRET`, attach a `system` actor marker
    - Augment `types/express.d.ts` with `req.superAdmin`
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 17.5, 17.7_
  - [x] 2.6 Implement the Control_Plane audit writer usage and audit-query shaper
    - Add a thin control-plane wrapper that calls `writeAudit()` with `getControlPlaneSupabase()` and injects `scope:'platform'` + `store_id`; never inline `audit_log` inserts
    - Create `lib/platform/audit-query.ts` — pure query shaper: order by `created_at desc`, cap 100, optional valid `store_id` filter, invalid filter → error/no rows
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x]* 2.7 Write property tests for audit envelope, resilience, and query shaping
    - **Property 2: Every control-plane mutation and denial produces exactly one platform-scoped audit entry**
    - **Property 3: Audit-write failure never fails the operation**
    - **Property 4: Audit query ordering, cap, and store filter**
    - **Validates: Requirements 1.9, 3.6, 5.8, 6.4, 8.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.10, 14.8, 16.1, 17.1, 17.2, 17.6**
  - [x] 2.8 Wire the auth/MFA/session routes and the audit read route
    - Create `routes/platform/auth.ts` (`POST /platform/auth/mfa/enroll`, `/mfa/verify`, `POST`/`DELETE /platform/auth/session`) using Supabase TOTP factors; audit sign-in + enrollment outcomes
    - Create `routes/platform/audit.ts` (`GET /platform/audit?store_id=`) using `lib/platform/audit-query.ts`
    - Create `routes/platform/index.ts` aggregator mounted at `/api/platform` in `app.ts`; register literal paths before `/:id` routes
    - _Requirements: 1.9, 11.3, 11.4, 11.5, 17.1, 17.2, 17.6_

- [x] 3. Implement the Store_Registry lifecycle (create / activate / disable)
  - [x] 3.1 Implement the Platform_Status finite-state machine
    - Create `lib/platform/lifecycle.ts` — pure FSM: allowed transitions among `onboarding`/`active`/`suspended`/`disabled`, illegal → rejected (409 marker), idempotent suspend-on-suspended / reactivate-on-active, new store starts `onboarding` + `trialing`, case-insensitive name-collision check
    - _Requirements: 3.1, 3.2, 3.8, 3.9, 3.10, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2_
  - [x]* 3.2 Write property test for the lifecycle FSM
    - **Property 11: Platform_Status lifecycle transitions form a valid state machine**
    - **Validates: Requirements 3.1, 3.2, 3.8, 3.9, 3.10, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2**
  - [x] 3.3 Implement the lifecycle routes and Zod schemas
    - Create `routes/platform/lifecycle.ts`: `POST /platform/stores` (registry-only create → `onboarding`+`trialing`, store the credential **hash/reference only**), `POST /platform/stores/:id/activate`, `POST /platform/stores/:id/disable`
    - Validate every body with `validate(schema)` (Zod), naming offending fields on `400`; case-insensitive name collision → `409`; unknown store → `404`; illegal transition → `409`; audit each status change with prior/new status + UTC timestamp via the control-plane audit wrapper
    - Do NOT call any Store-provisioning routine — creation records the registry entry only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 5.10, 6.2_
  - [x]* 3.4 Write example/edge tests for registry-only creation
    - Assert creation performs no infrastructure-provisioning call and persists only the credential hash/reference (R5.10), and that a created store is `onboarding`+`trialing`
    - _Requirements: 5.10, 6.2, 9.2_

- [x] 4. Implement the store-side platform-status self-gate hook (additive, fail-safe-to-active)
  - [x] 4.1 Implement the self-gate decision + pull-with-cache logic
    - Create `lib/store-hooks/platform-status.ts` — pure decision: given a cached status + operation kind, `suspended` → block admin writes/new orders (403) but allow admin reads; `disabled` → deny all; else permit. Include the resolver: use fresh cache; on Control_Plane unavailability fall back to last-known, else `active` (**fail-safe**)
    - _Requirements: 3.3, 3.4, 5.5_
  - [x]* 4.2 Write property test for the self-gate decision incl. fail-safe
    - **Property 12: The Store enforces suspended and disabled status (self-gate), fail-safe to active**
    - **Property 13: Reactivation restores pre-suspension behavior with data intact**
    - **Validates: Requirements 3.3, 3.4, 3.7, 5.5**
  - [x] 4.3 Add the Control_Plane status endpoint and the store-side pull hook + middleware
    - Add `GET /platform/store-status` to `routes/platform/store-feed.ts` (Per_Store_Credential auth; resolves caller's store; returns its `platform_status`)
    - Add a store-side `platformStatus` middleware in the store/api pipeline that reads the store-local TTL cache (~60s) populated by a periodic pull of `GET /platform/store-status`, applying `lib/store-hooks/platform-status.ts`
    - _Requirements: 3.3, 3.4, 5.5_
  - [x]* 4.4 Write the fail-safe integration test
    - With the Control_Plane unreachable and no fresh cache, assert the store-side gate keeps the Store `active` (a Control_Plane outage never blocks a paying Store)
    - _Requirements: 3.3, 5.5_

- [x] 5. Checkpoint — Phase 0 foundations shippable
  - Ensure all tests pass, ask the user if questions arise.

---

### Phase 1 — Operations

- [x] 6. Implement store-side credential verification and the aggregate-only metrics endpoint (isolation-critical, front-loaded)
  - [x] 6.1 Implement the Per_Store_Credential verifier
    - Create `lib/store-hooks/credential.ts` — pure verifier: require `X-Store-Id` == this Store's id (else 403, foreign credential), require bearer present (else 401), constant-time compare bearer vs the Store's own secret (else 403); returns no data on any failure
    - _Requirements: 9.3, 9.6_
  - [x]* 6.2 Write property test for credential verification
    - **Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials**
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6**
  - [x] 6.3 Implement the Store_Metrics_Endpoint (aggregate-only shaper)
    - Add the store-side `GET {metrics_endpoint_url}?from=&to=` returning only `order_count`, `revenue_total` (2dp string), optional `traffic_count`, `quota_usage` integers, and the inclusive `range`; compute from the Store's own DB and return **no raw records**
    - Guard with `lib/store-hooks/credential.ts`
    - _Requirements: 9.4, 9.5, 2.3_
  - [x]* 6.4 Write integration test for foreign-credential rejection + aggregate-only response
    - Mock Store endpoint: assert a foreign credential is rejected and a success payload contains only aggregates (no raw orders/customers/products)
    - _Requirements: 9.3, 9.4, 9.5_

- [x] 7. Implement metrics polling and the aggregate-only ingest (isolation-critical, front-loaded)
  - [x] 7.1 Implement the metrics ingest whitelist
    - Create `lib/platform/metrics-ingest.ts` — pure transform: from an arbitrary Store payload (even one containing raw-record-shaped fields), produce only the whitelisted aggregate fields for `store_metrics_cache`; discard everything else
    - _Requirements: 9.2, 9.8_
  - [x]* 7.2 Write property test for the ingest whitelist
    - **Property 5: The Control_Plane persists only aggregate numbers from a Store, never raw records**
    - **Validates: Requirements 9.2, 9.8**
  - [x] 7.3 Add the `store_metrics_cache` migration
    - Create `store_metrics_cache` (store_id PK, nullable order_count/revenue_total/traffic_count, quota_usage jsonb, `available` flag, `fetched_at`) in the control-plane project
    - _Requirements: 2.2, 2.10, 9.2_
  - [x] 7.4 Implement the metrics poller endpoint
    - Add `POST /platform/metrics/poll` (`requireServiceCredential`) in `routes/platform/metrics.ts`: iterate the Store_Registry, call each Store's metrics endpoint with its Per_Store_Credential, persist via `lib/platform/metrics-ingest.ts` with `available=true`/fresh `fetched_at`; on unreachable/error mark `available=false` (registry untouched)
    - _Requirements: 2.2, 2.10, 9.1, 9.2_
  - [x]* 7.5 Write integration test for end-to-end aggregate-only ingest
    - Against a mock Store endpoint, assert the poller authenticates with the correct credential and persists only aggregates; unreachable Store → `available=false` row, not dropped
    - _Requirements: 2.10, 9.2_

- [x] 8. Implement the cross-store dashboard, ranges, filtering, and detail
  - [x] 8.1 Implement time-range/period validation + windowing
    - Create `lib/platform/range.ts` — pure: `start > end` / missing endpoint / non-date / >366 days → 400; else inclusive endpoints; default last 30 days when absent
    - _Requirements: 2.5, 2.6, 2.7_
  - [x]* 8.2 Write property test for range validation
    - **Property 19: Time-range/period validation and inclusive windowing**
    - **Validates: Requirements 2.5, 2.6, 2.7, 19.4, 19.5, 19.6, 19.7**
  - [x] 8.3 Implement the dashboard list shaper and subscription-status filter
    - Create `lib/platform/dashboard.ts` — pure shaper: each row exposes name, platform_status, subscription_status, plan (distinct from status), counts as non-negative integers, revenue/quota formatted, page size 20; unavailable cached metrics → row present with metric fields marked unavailable (not omitted)
    - Create `lib/platform/subscription.ts` filter function returning exactly the Stores matching a `subscription_status` value (empty when none)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 2.10, 6.5, 6.6, 6.7_
  - [x]* 8.4 Write property tests for the dashboard shaper and filter
    - **Property 18: Dashboard list shape, metric formatting, and unavailable-metric handling**
    - **Property 17: Subscription-status filtering returns exactly matching Stores**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8, 2.10, 6.5, 6.6, 6.7**
  - [x] 8.5 Implement the dashboard/detail routes
    - Add to `routes/platform/stores.ts`: `GET /platform/stores` (paginated, `?subscription_status=` filter, page/pageSize default 20), `GET /platform/stores/:id` (detail + latest cached metrics), `GET /platform/stores/:id/metrics?from=&to=` (from `store_metrics_cache`); empty registry → empty list
    - _Requirements: 2.1, 2.2, 2.4, 2.8, 2.9, 2.10, 6.5, 6.6, 6.7_
  - [x] 8.6 Build the Store_Dashboard frontend page
    - Create `artifacts/store/src/pages/platform/StoreDashboardPage.tsx` and `StoreDetailPage.tsx` using `useAdminList()` / `DataTable` / `Pagination` (page size 20); all labels via `useI18n()` `t(key)` for az/ru/en
    - _Requirements: 2.1, 2.2, 2.3, 2.8, 2.11_

- [x] 9. Implement suspend / reactivate and store-side enforcement
  - [x] 9.1 Implement suspend/reactivate routes (idempotent, audited)
    - Add to `routes/platform/lifecycle.ts`: `POST /platform/stores/:id/suspend` (→`suspended` ≤5s, idempotent), `POST /platform/stores/:id/reactivate` (`suspended`→`active` ≤5s, idempotent); set `status_before_suspend`/`suspended_at`; unknown store → `404`; audit prior/new status + UTC timestamp
    - _Requirements: 3.1, 3.2, 3.6, 3.8, 3.9, 3.10_
  - [x] 9.2 Implement the suspended-order rejection guard ordering in the Store
    - Wire the store-side order-submit path so the `platformStatus` gate runs **before** any `decrement_stock_safe` call: `suspended` → `403`, no order row created/modified, no stock decremented (single atomic outcome)
    - _Requirements: 3.5, 4.4_
  - [x]* 9.3 Write property test for atomic suspended-order rejection
    - **Property 14: Suspended-Store order rejection is atomic**
    - **Validates: Requirements 3.5, 4.4**
  - [x] 9.4 Implement the suspended-state storefront notice (503) and admin write block
    - Create the store-side `SuspendedNotice` (HTTP 503, localized via active locale prefix, default `az`, excludes product/cart/checkout content); block admin writes (403) while allowing admin reads; reactivation restores pre-suspension behavior
    - _Requirements: 3.3, 3.4, 3.7, 4.1, 4.2, 4.3, 4.5_
  - [x]* 9.5 Write property test for the suspended storefront notice
    - **Property 15: Suspended storefront renders a localized notice with 503**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.5**

- [x] 10. Implement platform notifications (compose / target) and the per-store store-feed (isolation-critical)
  - [x] 10.1 Implement notification targeting logic
    - Create `lib/notifications/target.ts` — pure: single / set(2–1000) / broadcast (= all non-`disabled` Stores) → exact target set; content empty/whitespace/>5000 → 400 no notification; any target id absent from registry → whole request 404, nothing created
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.8_
  - [x]* 10.2 Write property tests for targeting and content/target validation
    - **Property 9: Platform-message targeting addresses exactly the intended Stores**
    - **Property 10: Platform-message content and target validation is all-or-nothing**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.8**
  - [x] 10.3 Implement the per-store feed isolation, unread, and ordering logic
    - Create `lib/notifications/feed.ts` — pure: given notifications + targets + reads for a resolved store, return exactly that Store's notifications (exclude all others), unread count ≥ 0 = targeted-with-no-read, order `created_at desc, id desc`, each item exposes content/created_at/read-state; mark-read on non-existent/foreign → 404 leaving read state unchanged
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_
  - [x]* 10.4 Write property tests for feed isolation and ordering
    - **Property 7: Per-store notification fetch returns only the calling Store's notifications**
    - **Property 8: Notification inbox ordering and item shape**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8**
  - [x] 10.5 Add notification migrations
    - Create `platform_notifications`, `platform_notification_targets` (indexed by store_id), and `platform_notification_reads` (keyed `(notification_id, store_id)`) in the control-plane project
    - _Requirements: 7.1, 7.3, 8.1, 8.8_
  - [x] 10.6 Implement the compose route
    - Create `routes/platform/notify.ts` (`POST /platform/notifications`, `requireSuperAdmin`) using `lib/notifications/target.ts`; validate body with `validate(schema)`; non-super-admin → 403; audit the send (scope + identity + timestamp) **before** returning success; do not create/store any Store_Event_Notification
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 7.9_
  - [x] 10.7 Implement the store-feed fetch/mark-read endpoints
    - Add to `routes/platform/store-feed.ts` (Per_Store_Credential auth): `GET /platform/store-feed/notifications` (caller's notifications + unread count, newest-first id tie-break) and `POST /platform/store-feed/notifications/:id/read`; resolve the store id from the credential so a Store can only ever see its own
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.8, 8.8_
  - [-]* 10.8 Write integration test for store-feed isolation under Per_Store_Credential
    - Two Stores, overlapping/broadcast notifications: assert each store-feed fetch returns only the calling Store's notifications
    - _Requirements: 7.1, 8.8_
  - [x] 10.9 Build the Notification_Center frontend (inside the Store admin)
    - Create the store-side `NotificationCenter` (inbox + unread badge, read/unread state) fetching from the Control_Plane store-feed; all chrome via `useI18n()` for az/ru/en with no untranslated key or empty string
    - _Requirements: 7.2, 7.7_

- [x] 11. Checkpoint — Phase 1 operations shippable
  - Ensure all tests pass, ask the user if questions arise.

---

### Phase 2 — Monetization

- [x] 12. Implement subscription plans and subscription-status updates
  - [x] 12.1 Implement plan validation, guards, and the assignment invariant
    - Create `lib/platform/plans.ts` — pure: valid create/edit persists (edits round-trip price/interval/limits), invalid → 400 naming fields, case-insensitive name collision → 409, archive/delete with assigned Stores → 409 unchanged, assign to missing/archived plan → 409 distinguishing the two reasons, archived excluded from assignable set, each Store references exactly one plan
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.13, 13.14_
  - [-]* 12.2 Write property tests for plan guards and the one-plan invariant
    - **Property 21: Plan validation, uniqueness, and lifecycle guards**
    - **Property 22: Each Store always references exactly one plan**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.13, 13.14**
  - [x] 12.3 Implement the atomic subscription-status update logic
    - Extend `lib/platform/subscription.ts` with a pure update reducer: value in set → persisted; out-of-set/malformed/invalid store → 400, existing status unchanged; never a partial result
    - _Requirements: 6.3, 6.8, 6.9_
  - [-]* 12.4 Write property test for atomic subscription-status update
    - **Property 16: Subscription-status update is atomic and round-trips**
    - **Validates: Requirements 6.3, 6.8, 6.9**
  - [x] 12.5 Add plan migrations and the plans/subscription/assignment routes
    - Create `subscription_plans` (name_normalized unique, price, billing_interval, feature_flags, quota_limits, archived) migration
    - Create `routes/platform/plans.ts` (list/create/edit/archive/delete) and add `PATCH /platform/stores/:id/subscription-status` + `PUT /platform/stores/:id/plan` to `routes/platform/lifecycle.ts`; `validate(schema)` on all bodies; audit all mutations/assignments
    - _Requirements: 6.3, 6.4, 6.6, 6.7, 13.1, 13.5, 13.6, 13.8, 13.9, 13.10, 13.14_
  - [x] 12.6 Build the Plans frontend page
    - Create `artifacts/store/src/pages/platform/PlansPage.tsx` (list/create/edit/archive) via `useAdminList`/`DataTable`; strings via `useI18n()` az/ru/en
    - _Requirements: 13.1, 13.12_

- [x] 13. Implement invoices, manual billing, and optional automation
  - [x] 13.1 Implement invoice generation and the billing transition reducer
    - Create `lib/billing/generate.ts` — pure: first invoice at trial end (`created_at + trial_days`, default 14), subsequent periods from the persisted billing anchor + k·interval (no drift), exactly one invoice per interval (issue at boundary, due = issue + due_days 1–90 default 14, amount = plan price)
    - Create `lib/billing/transition.ts` — pure reducer: paid on/before due → `active`; unpaid at due → `past_due` + grace start (effective grace 0–365); grace end unpaid → platform_status `suspended`; payment while past_due → `active`; payment after non-payment suspension → `active`; no overdue → no auto-suspend; manual mark-paid drives the same transitions
    - _Requirements: 6.10, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 14.12_
  - [-]* 13.2 Write property tests for invoice generation and billing transitions
    - **Property 23: Invoice generation is exactly-once-per-interval with correct fields**
    - **Property 24: Automated billing lifecycle transitions are correct**
    - **Validates: Requirements 6.10, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 14.12**
  - [x] 13.3 Add billing migrations and the pluggable payment-gateway adapter
    - Create `invoices` (unique `(store_id, period_start, period_end)`), `grace_periods`, and `billing_config` (trial_days/due_days/grace_period_days/currency) migrations
    - Define a `PaymentGateway` adapter interface plus a `recordInvoicePayment()` helper shared by manual pay and the webhook
    - _Requirements: 14.1, 14.11, 6.10_
  - [x] 13.4 Implement the billing routes and the scheduler run endpoint
    - Create `routes/platform/billing.ts`: `GET /platform/stores/:id/invoices`, `POST /platform/invoices/:id/pay` (manual, also signature-verified webhook path), and `POST /platform/billing/run` (`requireServiceCredential`) calling an idempotent/convergent `lib/billing/scheduler.ts` run; system-actor audit on automated transitions; failures isolated per Store and re-attempted
    - _Requirements: 6.10, 14.8, 14.9, 14.11, 14.12_
  - [-]* 13.5 Write integration test for one end-to-end billing cycle
    - generate → past_due → grace → suspend; payment → reactivate; assert exactly-once invoice creation under a duplicate run
    - _Requirements: 14.1, 14.11_
  - [x] 13.6 Build the Billing frontend page
    - Create `artifacts/store/src/pages/platform/BillingPage.tsx` (invoice list + mark-paid) via admin building blocks; strings via `useI18n()`
    - _Requirements: 6.10_

- [x] 14. Implement platform analytics
  - [x] 14.1 Implement the analytics aggregation logic
    - Create `lib/platform/analytics.ts` — pure: MRR (normalized monthly, 2dp, platform currency), active/past_due/cancelled counts, new/churned within period, revenue-by-plan groups summing consistently, all from Control_Plane records only (never raw store records), zeros for empty period
    - _Requirements: 19.1, 19.2, 19.3, 19.8, 19.9_
  - [ ]* 14.2 Write property test for analytics aggregation
    - **Property 31: Analytics figures are correct aggregations from Control_Plane records with empty-state zeros**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.9**
  - [x] 14.3 Implement the analytics route and frontend page
    - Add `GET /platform/analytics?from=&to=` to `routes/platform/analytics.ts` (reuse `lib/platform/range.ts`; period validation → 400)
    - Create `artifacts/store/src/pages/platform/AnalyticsPage.tsx`; strings via `useI18n()` az/ru/en
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.11_

- [x] 15. Checkpoint — Phase 2 monetization shippable
  - Ensure all tests pass, ask the user if questions arise.

---

### Phase 3 — Support & hardening

- [x] 16. Implement impersonation / support access
  - [x] 16.1 Implement the impersonation session decision logic
    - Create `lib/platform/impersonation.ts` — pure: active session is read-only (write → 403, data unchanged), access confined to the single Store (other Store → denied), rejected after end or 60-minute expiry
    - _Requirements: 10.3, 10.4, 10.5, 10.7_
  - [ ]* 16.2 Write property test for impersonation access
    - **Property 20: Impersonation grants read-only single-Store access bounded in time**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.7**
  - [x] 16.3 Add the impersonation migration and routes
    - Create `impersonation_sessions` migration; create `routes/platform/impersonation.ts` (`POST /platform/impersonation` start ≤2s, `DELETE /platform/impersonation/:id` end ≤5s) obtaining access via the Store's authenticated endpoint/support link (never direct DB); audit start (success + rejection) and end (super-admin + expiry)
    - _Requirements: 10.1, 10.2, 10.5, 10.6_

- [x] 17. Implement offboarding and retention
  - [x] 17.1 Implement the offboarding state and guards logic
    - Create `lib/platform/offboarding.ts` — pure: initiate → 30-day retention; restore before window → pre-offboarding status with records intact; after window → export rejected + purge due within 24h; restore of purged → irrecoverable; purge only when explicit confirmation matches target Store, else rejected unchanged
    - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 16.9_
  - [ ]* 17.2 Write property test for offboarding guards
    - **Property 27: Offboarding retention, restore, and purge guards**
    - **Validates: Requirements 16.1, 16.3, 16.4, 16.5, 16.6, 16.9**
  - [x] 17.3 Add the offboarding migration, routes, and purge sweep
    - Create `store_offboarding` migration; create `routes/platform/offboarding.ts` (`offboard`, `export` ≤60s, `restore`, `purge` with typed confirmation) operating on Control_Plane records only, rotating the Per_Store_Credential hash on offboard; add the retention purge sweep to the `requireServiceCredential` scheduler; record store-instance teardown as a distinct step; audit all actions
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9_
  - [ ]* 17.4 Write example/edge tests for purge teardown step and id non-reuse
    - Assert teardown is recorded as a distinct step (R16.7) and purged ids are never reused to expose prior records (R16.8)
    - _Requirements: 16.7, 16.8_

- [x] 18. Implement plan-based quota limits (Control_Plane records the limit; the Store enforces)
  - [x] 18.1 Implement the quota math and claim/release logic
    - Create `lib/store-hooks/quota.ts` — pure: effective limit L (from plan, 0 when none); under any interleaving of concurrent claims for the same resource/window total granted ≤ L and recorded usage never exceeds L; create below limit permitted + increments, at/above → 403 naming the quota; delete decrements (floor 0); new window starts at 0; reads never blocked; usage query returns limit + usage as non-negative integers; lowering a limit below usage retains data (only further creates blocked)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.11, 15.12_
  - [ ]* 18.2 Write property tests for quota enforcement and read/lower invariants
    - **Property 25: Quota is enforced in the Store, never exceeded under concurrency, and usage tracks reality**
    - **Property 26: Quotas never block reads and lowering a quota never deletes data**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.11, 15.12**
  - [x] 18.3 Wire store-side quota enforcement against effective plan limits
    - Add the store-side effective-limit fetch (from the Control_Plane, derived from the assigned plan; treated as 0 when none) and enforce create operations atomically against the Store's own live counts using `lib/store-hooks/quota.ts`; expose quota usage to the metrics endpoint's `quota_usage`
    - _Requirements: 15.1, 15.2, 15.3, 15.6, 15.7, 15.10_

- [x] 19. Implement email-delivery hardening (multi-channel, retries, preferences, mandatory)
  - [x] 19.1 Implement the delivery planning/outcome reducer
    - Create `lib/notifications/delivery.ts` — pure: multi-channel type → plan in-app + email, record each attempt `succeeded|failed`; saved per-type preference applied except mandatory types; failed email → up to 3 more attempts ≥60s apart; in-app preserved regardless, including missing/malformed owner email (no email attempt, error recorded); billing/suspension types use email
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.7, 18.8, 18.9, 18.10_
  - [ ]* 19.2 Write property test for delivery planning/outcomes
    - **Property 29: Multi-channel delivery, preferences, retries, and in-app preservation**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.7, 18.8, 18.9, 18.10**
  - [x] 19.3 Add delivery migrations, the email adapter, and delivery wiring
    - Create `notification_deliveries` and `notification_preferences` migrations; define a pluggable `EmailProvider.send(...)` adapter (mockable); wire the compose path to initiate in-app + email delivery within 60s using `lib/notifications/delivery.ts`; add `GET/PUT /platform/stores/:id/notification-preferences`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.9, 18.10_

- [x] 20. Implement the cross-surface locale resolver and locale parity
  - [x] 20.1 Implement the locale resolve/fallback function
    - Create/extend the platform i18n resolver — pure: return requested-locale value when present, fall back to `az` when missing, render a non-key placeholder (never the raw key) when missing in both; applies to platform UI strings and email rendering
    - _Requirements: 4.2, 4.3, 7.7, 12.2, 12.5, 12.6, 13.12, 15.10, 18.5, 18.6, 19.11_
  - [ ]* 20.2 Write property + parity tests for locale resolution
    - **Property 30: Locale resolution and fallback across platform surfaces**
    - Also assert identical key sets with no empty values across `lib/i18n/messages/{az,ru,en}.ts`
    - **Validates: Requirements 4.2, 4.3, 7.7, 12.2, 12.5, 12.6, 13.12, 15.10, 18.5, 18.6, 19.11**
  - [x] 20.3 Add all platform/store-hook i18n keys to az/ru/en modules
    - Add every key used by the platform pages, Notification_Center, suspended notice, and emails to `lib/i18n/messages/{az,ru,en}.ts` with identical key sets and `az` default/fallback
    - _Requirements: 2.11, 7.7, 12.2, 13.12_

- [x] 21. Checkpoint — Phase 3 support & hardening shippable
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but the isolation-critical tests (2.7, 6.2, 6.4, 7.2, 7.5, 9.3, 10.4/10.8, 4.4) are strongly recommended because they protect the physical-isolation and fail-safe guarantees.
- Each phase (ending at a checkpoint: tasks 5, 11, 15, 21) is independently shippable.
- Every task references the specific requirements and/or design correctness properties it implements; property sub-tasks are placed next to the pure-logic module they validate so errors surface early.
- All control-plane routes use `getControlPlaneSupabase()` only and follow the house Express 5 patterns (`validate(schema)`, early-return, `req.log`, central `errorHandler`, `writeAudit`); the existing store schema is never migrated and no `tenant_id` is added.
- Standing up Store instances and delivering raw Per_Store_Credential secrets is manual / out-of-band (R5.10), not a coding task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "2.3", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "3.2", "4.2"] },
    { "id": 3, "tasks": ["2.6", "3.3", "4.3"] },
    { "id": 4, "tasks": ["2.7", "2.8", "3.4", "4.4"] },
    { "id": 5, "tasks": ["6.1", "7.1", "8.1", "10.1", "10.3"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.2", "7.3", "8.2", "8.3", "10.2", "10.4", "10.5"] },
    { "id": 7, "tasks": ["6.4", "7.4", "8.4", "8.5", "9.1", "10.6", "10.7"] },
    { "id": 8, "tasks": ["7.5", "8.6", "9.2", "9.4", "10.8", "10.9"] },
    { "id": 9, "tasks": ["9.3", "9.5"] },
    { "id": 10, "tasks": ["12.1", "12.3", "13.1", "14.1"] },
    { "id": 11, "tasks": ["12.2", "12.4", "12.5", "13.2", "13.3", "14.2"] },
    { "id": 12, "tasks": ["12.6", "13.4", "14.3"] },
    { "id": 13, "tasks": ["13.5", "13.6"] },
    { "id": 14, "tasks": ["16.1", "17.1", "18.1", "19.1", "20.1"] },
    { "id": 15, "tasks": ["16.2", "17.2", "18.2", "19.2", "20.2"] },
    { "id": 16, "tasks": ["16.3", "17.3", "18.3", "19.3", "20.3"] },
    { "id": 17, "tasks": ["17.4"] }
  ]
}
```
