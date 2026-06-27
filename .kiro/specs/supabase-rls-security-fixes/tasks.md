# Implementation Plan: Supabase RLS Security Fixes

## Overview

This plan remediates the seven audit findings (SEC-001 … SEC-007) plus the two cross-cutting requirements (SEC-008 authenticated profile-write endpoint, 2.10 migration-delivery / live-schema reconciliation) using the bug-condition methodology: **explore** (demonstrate each defect on the unfixed policy/code), **preserve** (capture `¬C` behavior that must not change — above all service-role ops that bypass RLS), **implement** (apply the fix), **validate** (Fix-Checking + Preservation).

Tasks are sequenced by the design's **P0 → P1 → P2** priority so each band is independently shippable:

- **P0 — Privilege escalation (Critical):** SEC-001 `users.role` immutability (all three defenses + role-immutability trigger) and SEC-008 profile-endpoint hardening. Gated by a mandatory pre-flight live-schema verification of the trigger claim expression. Properties 1, 8.
- **P1 — Data exposure / world-write (High):** SEC-002 drop `size_guides` world-write, SEC-003 drop `coupons` public read + `GET /admin/coupons`, SEC-004 comment-moderation insert policy. Properties 2, 3, 4, 8.
- **P2 — Hardening / misconfiguration (Medium → Low):** SEC-005 `is_admin()` helper + in-scope policy rewrites, SEC-006 `getAdminSupabase()` fail-fast, SEC-007 control-plane credential removal + deny-by-default assertion. Properties 5, 6, 7, 8.

**Methodology guarantees applied throughout:**
- Every SQL change ships as a migration under `supabase/migrations/` (control-plane under `supabase/control-plane/migrations/`) and is mirrored into `supabase/schema.sql`. Each migration carries a **live-schema reconciliation** sub-step (2.10): dump/verify the live policy/grant/trigger names **before** `drop`, re-verify the end-state **after** apply, then mirror into `schema.sql`.
- Test-only / optional tasks are marked with the repo `*` convention (`- [ ]* N.M …`).
- Tests are tagged to the design Property they validate and to their role (Fix-Checking vs Preservation).
- **3-layer testing:** unit/property (vitest, no DB) for pure logic and request shaping; **RLS-level integration** (CI `integration-e2e` job, Supabase with anon + service-role keys) where the policy *is* the assertion; E2E for the end-to-end profile / admin-coupons flows. DOM tests run in jsdom and assert behavior (never regex on source — per the project test-quality steering rule).
- Service-role (API server) operations are `¬C` for every finding and MUST remain byte-for-byte unchanged.

---

## Tasks

### P0 — SEC-001 + SEC-008 (Critical: privilege escalation)

- [x] 1. Pre-flight: verify the trigger claim expression against the LIVE database
  - **Checkable gate — MUST complete and pass BEFORE applying the P0 migration (task 4).**
  - On the LIVE store DB, confirm which claim helper is populated (`auth.role()` / `auth.jwt()` / `request.jwt.claims`) and that the chosen expression `current_setting('request.jwt.claims', true)::json ->> 'role'` returns `'service_role'` under a service-key connection and `'authenticated'`/`'anon'` under a client connection
  - Probe: run `select current_setting('request.jwt.claims', true)::json ->> 'role'` once under the service key and once under the anon key; record both results
  - IF the live DB exposes the claim differently, adjust the expression to the verified form and update the SEC-001 migration text in task 4 before applying
  - Record the verified expression and the `current_user` value seen on a service-role connection (expected `service_role`) so the trigger's secondary signal is confirmed
  - _Requirements: 2.1, 2.10_

- [x] 2. Exploration: demonstrate the SEC-001 privilege-escalation defect on UNFIXED code
  - **Property 1: Bug Condition** - `users.role` self-update via anon client
  - **IMPORTANT:** Write these tests BEFORE the fix; **DO NOT** fix code when they fail/expose the defect
  - **GOAL:** surface the counterexample proving the bug exists
  - **Scoped approach (deterministic):** scope to the concrete failing case `update users set role='admin' where id = auth.uid()` issued via the anon-key client as `authenticated`
  - RLS integration (anon key): assert the `role` update currently **succeeds** on the unfixed `"Users: own row" for all` policy (this is the defect)
  - Then assert that `requireAdmin` would read `role='admin'` and grant `/admin/*` — documenting the full escalation trust chain
  - **EXPECTED OUTCOME on unfixed code:** the write is accepted (counterexample captured); after the fix this same test must show REJECTED
  - Document the counterexample (e.g. "anon-key update({role:'admin'}) returned 200, row.role became 'admin'")
  - _Requirements: 1.1, 2.1_

- [x] 3. Preservation baseline: capture SEC-001 / SEC-008 `¬C` behavior on UNFIXED code
  - **Property 8: Preservation** - service-role writes + legitimate profile edits unchanged
  - **IMPORTANT:** observation-first — record actual outputs on the unfixed system, then encode them
  - Observe + record: service-role `update users set role=…` succeeds (bypasses RLS); service-role profile `update {full_name, default_address}` succeeds
  - Observe + record: a legitimate customer `{full_name, default_address}` edit currently persists
  - Observe + record: a fresh auth signup creates the `public.users` row via the `handle_new_user()` `security definer` trigger (the INSERT path) on unfixed code — this is the one users-write path NOT covered by the profile endpoint; SEC-001 revokes UPDATE / makes `users` SELECT-only for clients but does NOT touch INSERT or the definer trigger, so signup must keep working (Property 8 [3.1])
  - Write property/integration tests asserting those observed outcomes; verify they PASS on unfixed code (they must still PASS after the fix)
  - _Requirements: 3.1, 3.8_

- [x] 4. Fix SEC-001: `users.role` immutability migration (all three defenses + trigger)
  - Create `supabase/migrations/20240101_sec001_users_role_immutability.sql` containing ALL THREE defenses together (mandatory, not either/or):
    - (a) drop `"Users: own row"` (`for all`); create SELECT-only `"Users: own row read"` using `auth.uid() = id`
    - (b) `revoke update on public.users from authenticated`; then `grant update (full_name, default_address) on public.users to authenticated` — never `role`/`email`/`phone`
    - (c) `create or replace function public.enforce_role_immutability()` (`security invoker`) rejecting any `new.role is distinct from old.role` unless caller is service role, using the verified claim expression from task 1 (PRIMARY: `nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' = 'service_role'` — equivalently `auth.jwt() ->> 'role' = 'service_role'`; SECONDARY: `current_user in ('service_role','postgres','supabase_admin')`), raising `42501`; create `before update` trigger `trg_users_role_immutable`
    - **Task 1 pre-flight verified (see `preflight-sec001.md`):** the claim resolves `service_role`/`anon`/`authenticated` as designed and `current_user='postgres'` on the migration connection. The bare `current_setting('request.jwt.claims', true)::json ->> 'role'` form from design.md MUST be wrapped in `nullif(…, '')` (or use `auth.jwt() ->> 'role'`) because an empty-string GUC raises `22P02 invalid input syntax for type json` inside the trigger; the `nullif`/`auth.jwt()` forms are empty-string-safe (verified live)
  - **Deploy coupling (atomic unit — auto-deploy from `main`):** task 5's `LoginModal.tsx:134` re-route (5.3) and the profile-endpoint hardening (5.1/5.2) MUST land together-with-or-before this users-write lockdown migration. Otherwise there is a deploy window where customer name/profile updates fail. The `PATCH /profile` endpoint already works via the service role, so the only client breakage to avoid is the `LoginModal` direct anon write — sequence 5.3 with/before task 4 in deployment.
  - [x] 4.1 Live-schema reconciliation BEFORE drop (2.10)
    - Dump the live policy/grant/trigger state for `public.users`; confirm the real current name of the `for all` own-row policy matches the `drop policy if exists` target before applying
    - _Requirements: 2.10_
  - [x] 4.2 Apply the migration and reconcile AFTER (2.10)
    - Re-dump live `public.users` policies/grants/triggers; confirm end-state is exactly: SELECT-only read policy, `update(full_name, default_address)` grant only, role-immutability trigger present
    - Mirror the final definitions into `supabase/schema.sql` (replace `schema.sql:34` `"Users: own row" for all`; append revoke/grant/function/trigger in the `users` block); regenerate `@workspace/supabase-types` if column-level update types changed
    - _Requirements: 2.10_
  - _Bug_Condition: isBugCondition(X) = caller='authenticated' ∧ table='users' ∧ op='UPDATE' ∧ 'role' ∈ columns_
  - _Expected_Behavior: client role write REJECTED; requireAdmin still 403; all three defenses present_
  - _Preservation: service-role writes on users unchanged (trigger allows service role) [3.1]_
  - _Design: Property 1_
  - _Requirements: 2.1, 2.10, 3.1_

- [x] 5. Fix SEC-008: harden the authenticated profile-write endpoint + re-route the client write
  - **Deploy coupling (atomic unit — auto-deploy from `main`):** 5.3 (the `LoginModal.tsx:134` re-route) and 5.1/5.2 (profile-endpoint hardening) MUST deploy together-with-or-before the SEC-001 users-write lockdown (task 4). The `PATCH /profile` endpoint already writes via the service role and keeps working, so the sole client path that breaks if task 4 lands first is the `LoginModal` direct anon write — sequence 5.3 with/before task 4.
  - [x] 5.1 Add `UpdateProfileSchema` and wire `validate()` into `PATCH /profile`
    - In `artifacts/api-server/src/routes/profile.ts` (or a co-located `routes/schemas.ts`), define `UpdateProfileSchema` whitelisting `full_name` and `default_address` only, `.strict()` (loud `400` on stray keys like `role`/`email`/`phone`) with a `.refine()` requiring at least one field
    - Wire `validate(UpdateProfileSchema)` middleware into the existing `PATCH /profile` route; read body from `req.validatedBody`; derive target id from `req.authUser!.id` (never from body)
    - _Requirements: 2.8_
  - [x] 5.2 Correct GET and PATCH handlers to the Express 5 convention
    - Bring BOTH `GET /profile` and `PATCH /profile` to `async (req, res): Promise<void>` with `res.status(...).json(...); return;` early-returns (never `return res.json(...)`)
    - Remove any `try/catch`-for-500 (central `errorHandler` auto-forwards); keep service-role write via `getAdminSupabase()`
    - _Requirements: 2.8, 3.1, 3.8_
  - [x] 5.3 Re-route `LoginModal.tsx:134` to the profile endpoint
    - In `artifacts/store/src/components/auth/LoginModal.tsx`, replace the anon-client `createClient().from("users").update({ full_name })` in `handleNameSubmit` with `userFetch(apiUrl("/profile"), { method: "PATCH", … body: { full_name } })`
    - Confirm `useProfile.ts updateProfile` already PATCHes `/profile` via `userFetch` (no change needed) so no client path still depends on the dropped write policy
    - _Requirements: 2.8, 2.9, 3.8_
  - _Bug_Condition: profile writes share the dropped client-write path (1.8); replacement must accept own-row `{full_name, default_address}` only_
  - _Expected_Behavior: id from token; `role`/`email`/`phone` stripped or 400; service-role write persists_
  - _Preservation: legitimate `{full_name, default_address}` edits still persist [3.8]; service-role unchanged [3.1]_
  - _Design: Property 1, Property 8_
  - _Requirements: 2.8, 2.9, 3.1, 3.8_

- [x] 6. Verify P0 fix (Fix-Checking + Preservation re-run)
  - [x] 6.1 Re-run the SEC-001 exploration test on FIXED code
    - **Property 1: Expected Behavior** - role write rejected from the client
    - Re-run the SAME test from task 2 (do not write a new one): anon-key `update({role:'admin'})` now returns an RLS error (`42501`); `requireAdmin(nonAdmin)` still returns 403
    - **EXPECTED OUTCOME:** REJECTED (confirms the bug is fixed)
    - _Requirements: 2.1_
  - [x] 6.2 Re-run the P0 preservation tests on FIXED code
    - **Property 8: Preservation** - service-role + profile edits unchanged
    - Re-run the SAME tests from task 3: service-role `update users` (role assignment, profile) still succeeds (trigger allows); legitimate `{full_name, default_address}` edit still persists
    - Re-verify: a fresh auth signup still creates the `public.users` row after the SEC-001 lockdown (INSERT + `handle_new_user()` definer trigger untouched) — the one users-write path not otherwise covered (Property 8 [3.1])
    - **EXPECTED OUTCOME:** PASS (no regressions)
    - _Requirements: 3.1, 3.8_
  - [x] 6.3 Typecheck + build + unit gate for P0-touched code
    - Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run test` (unit gate) for the P0-touched code (`artifacts/api-server/src/routes/profile.ts`, `artifacts/store/src/components/auth/LoginModal.tsx`) so TS/build errors surface per-band instead of only at the final gate (task 24)
    - _Requirements: 2.8, 3.8_

#### P0 tests

- [x] 7. Unit/property tests for SEC-001 / SEC-008 (vitest, no DB)
  - `UpdateProfileSchema`: rejects `{ role: "admin" }` with loud `400` (`.strict()`); accepts `{ full_name }` / `{ default_address }`; rejects empty object; **property**: identity-preserving for valid `{full_name?, default_address?}` across generated strings within bounds, never emits `role`/`email`/`phone` (Fix-Checking + Preservation, Property 1 / Property 8) — in `artifacts/api-server` test dir
  - `PATCH /profile` handler derives id from `req.authUser!.id` and ignores a mismatched body `id` (mock `getAdminSupabase`, assert update targets token id) (Fix-Checking, Property 1)
  - `LoginModal` `handleNameSubmit` (jsdom): renders, mock fetch, assert it calls `userFetch('/profile', PATCH)` with `{ full_name }` body and makes **no** direct Supabase client write (behavioral DOM test, Fix-Checking, Property 1)
  - Structural migration assertion: `20240101_…` contains the SELECT-only policy AND `grant update (full_name, default_address)` AND the role-immutability trigger (all three defenses shipped) (Fix-Checking, Property 1)
  - _Requirements: 2.1, 2.8_

- [x] 8. RLS-level integration tests for SEC-001 (CI `integration-e2e`, anon + service-role keys)
  - anon-key `update users set role='admin'` → error (`42501`) — Fix-Checking, Property 1
  - service-role `update users set role=…` → succeeds (trigger allows) — Preservation, Property 8 [3.1]
  - service-role + endpoint `PATCH /profile` then `GET /profile` returns the new `full_name`/`default_address` — Fix-Checking + Preservation, Property 1 / Property 8 [3.8]
  - **Property 8: Preservation** — a fresh auth signup results in a `public.users` row after the lockdown (the `handle_new_user()` `security definer` INSERT trigger is untouched by SEC-001); this is the one users-write path not otherwise covered — Preservation, Property 8 [3.1]
  - _Requirements: 2.1, 2.8, 3.1, 3.8_

---

### P1 — SEC-002 + SEC-003 + SEC-004 (High: data exposure / world-write)

- [x] 9. Exploration: demonstrate the P1 defects on UNFIXED code
  - **Property 2: Bug Condition** - `size_guides` world-writable; **Property 3: Bug Condition** - `coupons` anon-readable; **Property 4: Bug Condition** - comment moderation bypass
  - **IMPORTANT:** write BEFORE the fixes; expect them to expose the defects; do not fix on failure
  - SEC-002 (anon key): `insert/update/delete size_guides` with a valid `category_id` currently **persists** (fails only on FK otherwise) — capture counterexample
  - SEC-003 (anon key): `select coupons` currently returns active codes (`WELCOME10`, `FLAT20`, `TEST_10PCT`, `TEST_5AZN`) with discount values — capture counterexample
  - SEC-004 (authenticated): `insert comments {approved:true}` currently **accepted** and published unmoderated — capture counterexample
  - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 2.4_

- [x] 10. Preservation baseline: capture P1 `¬C` behavior on UNFIXED code
  - **Property 8: Preservation** - public reads, coupon validation, moderation flow unchanged
  - Observe + record: public `select size_guides` returns rows; service-role `size_guides` write succeeds [3.2]
  - Observe + record: `POST /api/coupons/validate` for `WELCOME10` returns the correct discount; `lib/coupon-calc.ts calculateDiscount()` outputs [3.3]
  - Observe + record: authenticated `insert comments {approved:false}` succeeds and stays hidden; admin moderation via service role works [3.4]
  - Observe + record: admin coupons page currently renders the list (via anon read) [3.9]
  - Verify these PASS on unfixed code
  - _Requirements: 3.2, 3.3, 3.4, 3.9_

- [x] 11. Fix SEC-002: drop `size_guides` world-write policy
  - Create `supabase/migrations/20240102_sec002_drop_size_guides_world_write.sql`: `drop policy if exists "size_guides_admin_write" on public.size_guides;` (retain `size_guides_read` public select)
  - [x] 11.1 Live-schema reconciliation BEFORE drop (2.10)
    - Dump live `size_guides` policies; confirm the real world-write policy name matches the `drop` target before applying
    - _Requirements: 2.10_
  - [x] 11.2 Apply + reconcile AFTER (2.10)
    - Re-dump: confirm only the public read policy remains, no client write policy; mirror into `supabase/schema.sql` (remove the write policy from the `create_size_guides.sql` definition; keep `size_guides_read`)
    - _Requirements: 2.10_
  - _Bug_Condition: caller ∈ {anon, authenticated} ∧ table='size_guides' ∧ op ∈ {INSERT, UPDATE, DELETE}_
  - _Expected_Behavior: client write REJECTED (`42501`/401/403); service-role write + public read unchanged_
  - _Preservation: service-role size-guide writes (routes/size-guides.ts) + public read unchanged [3.2]_
  - _Design: Property 2_
  - _Requirements: 2.2, 2.10, 3.2_

- [x] 12. Fix SEC-003: add `GET /admin/coupons` + re-route CouponsPage, THEN drop public coupon read
  - **Atomic unit (auto-deploy from `main`):** ALL of task 12's sub-steps MUST ship as ONE atomic unit. The admin read path (12.1 endpoint + 12.2 `CouponsPage` re-route) MUST land BEFORE the public-read policy drop (12.3) takes effect, so there is never a deploy window where the admin coupon list is broken.
  - [x] 12.1 Add `GET /admin/coupons` (service role, `requireAdmin`)
    - In `artifacts/api-server/src/routes/admin/coupons.ts`, add `router.get("/admin/coupons", requireAdmin, async (req, res): Promise<void> => …)` selecting all coupons via `req.admin!` ordered by `created_at desc`; register the literal route alongside existing `POST`/`:id` (no `/:id` collision on the bare path); Express 5 early-return convention; no try/catch-for-500
    - _Requirements: 2.9, 3.9_
  - [x] 12.2 Re-route `CouponsPage.tsx` to `adminFetch`
    - In `artifacts/store/src/pages/admin/CouponsPage.tsx`, replace the anon-client `createClient().from("coupons").select("*")` list read with `adminFetch(apiUrl("/admin/coupons"))`; remove the now-unused `createClient` import if nothing else uses it; mutations already use `adminFetch` (unchanged); `POST /api/coupons/validate` untouched
    - _Requirements: 2.9, 3.9_
  - [x] 12.3 Drop the public-read policy (migration) — only after 12.1 + 12.2 are in place
    - Create `supabase/migrations/20240103_sec003_drop_coupons_public_read.sql`: `drop policy if exists "Coupons: public read active" on public.coupons;` — introduce **no** public coupon-read view
    - _Requirements: 2.3_
  - [x] 12.4 Live-schema reconciliation BEFORE/AFTER (2.10)
    - BEFORE: dump live `coupons` policies; confirm the real public-read policy name matches the `drop` target
    - AFTER: re-dump; confirm no anon `select` policy remains and no public view added; mirror into `supabase/schema.sql`
    - _Requirements: 2.10_
  - _Bug_Condition: caller='anon' ∧ table='coupons' ∧ op='SELECT'_
  - _Expected_Behavior: anon select returns 0 rows; validation only via POST /api/coupons/validate; admin list via service-role endpoint_
  - _Preservation: coupon validation/math unchanged [3.3]; admin list still renders via GET /admin/coupons [3.9]_
  - _Design: Property 3_
  - _Requirements: 2.3, 2.9, 2.10, 3.3, 3.9_

- [x] 13. Fix SEC-004: constrain comment insert to `approved = false`
  - Create `supabase/migrations/20240104_sec004_comments_insert_unapproved_only.sql`: `drop policy if exists "Comments: own insert"`; `create policy "Comments: own insert" … for insert with check (auth.uid() = user_id and approved = false)` (retain public-read-approved and admin-all policies)
  - [x] 13.1 Live-schema reconciliation BEFORE/AFTER (2.10)
    - BEFORE: dump live `comments` policies; confirm the real insert policy name matches the `drop` target
    - AFTER: re-dump; confirm the insert check now includes `approved = false`; mirror into `supabase/schema.sql` (replace `schema.sql:344`)
    - _Requirements: 2.10_
  - _Bug_Condition: caller='authenticated' ∧ table='comments' ∧ op='INSERT' ∧ row.approved=true_
  - _Expected_Behavior: approved=true insert REJECTED; approved=false insert succeeds and stays hidden until admin approval_
  - _Preservation: approved=false inserts + admin moderation via service role unchanged [3.4]_
  - _Design: Property 4_
  - _Requirements: 2.4, 2.10, 3.4_

- [x] 14. Verify P1 fixes (Fix-Checking + Preservation re-run)
  - [x] 14.1 Re-run P1 exploration tests on FIXED code
    - **Property 2: Expected Behavior** / **Property 3: Expected Behavior** / **Property 4: Expected Behavior**
    - Re-run the SAME tests from task 9: anon `size_guides` write → `42501`; anon `select coupons` → `[]`; authenticated `insert comments {approved:true}` → rejected
    - **EXPECTED OUTCOME:** REJECTED / EMPTY (bugs fixed)
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 14.2 Re-run P1 preservation tests on FIXED code
    - **Property 8: Preservation**
    - Re-run the SAME tests from task 10; all still PASS (public size-guide read, coupon validation, approved=false insert + moderation, admin coupon list render)
    - **EXPECTED OUTCOME:** PASS (no regressions)
    - _Requirements: 3.2, 3.3, 3.4, 3.9_
  - [x] 14.3 Typecheck + build + unit gate for P1-touched code
    - Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run test` (unit gate) for the P1-touched code (`artifacts/api-server/src/routes/admin/coupons.ts`, `artifacts/store/src/pages/admin/CouponsPage.tsx`) so TS/build errors surface per-band instead of only at the final gate (task 24)
    - _Requirements: 2.9, 3.9_

#### P1 tests

- [x] 15. Unit/property tests for SEC-003 request shaping (vitest, no DB)
  - `GET /admin/coupons` handler: admin → returns rows; non-admin → 403 (mock `requireAdmin` + `getAdminSupabase`) (Fix-Checking, Property 3)
  - `CouponsPage` (jsdom): renders the list via `adminFetch('/admin/coupons')` and makes **no** direct Supabase client read (behavioral DOM test, not regex on source) (Fix-Checking, Property 3 / Property 8 [3.9])
  - `POST /api/coupons/validate` + `calculateDiscount()` preservation: existing coupon-calc property tests stay green across generated subtotals/coupon configs (Preservation, Property 8 [3.3])
  - Structural migration assertions: SEC-002 drops the world-write policy; SEC-004 insert check expression includes `approved = false` (Fix-Checking, Properties 2, 4)
  - _Requirements: 2.2, 2.3, 2.4, 2.9, 3.3, 3.9_

- [x] 16. RLS-level integration tests for SEC-002 / SEC-003 / SEC-004 (CI `integration-e2e`)
  - SEC-002: anon `insert/update/delete size_guides` → `42501`; service-role insert ok; anon `select` ok (Fix-Checking + Preservation, Property 2 [3.2])
  - SEC-003: anon `select coupons` → `[]`; `POST /api/coupons/validate` still validates `WELCOME10` (Fix-Checking + Preservation, Property 3 [3.3])
  - SEC-004: authenticated insert `approved=true` → rejected; `approved=false` → ok and excluded from public `select` until admin approves via service role (Fix-Checking + Preservation, Property 4 [3.4])
  - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.3, 3.4_

---

### P2 — SEC-005 + SEC-006 + SEC-007 (Medium → Low: hardening / misconfiguration)

- [x] 17. Exploration: observe the P2 conditions on UNFIXED code
  - **Property 5: Bug Condition** - recursive admin policies; **Property 6: Bug Condition** - service-key silent fallback; **Property 7: Bug Condition** - control-plane credential in bundle
  - SEC-005: direct authenticated `select users`/`audit_log` → observe (live returns `200 []`, **no** `42P17` — refutes runtime recursion; record the downgrade to maintainability hardening)
  - SEC-006: boot api-server with `SUPABASE_SERVICE_ROLE_KEY` unset → observe it currently **starts** with an anon "admin" client (silent degradation) — capture counterexample
  - SEC-007: inspect the built storefront bundle / `vercel.json` → observe it currently **contains** `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` — capture counterexample
  - _Requirements: 1.5, 1.6, 1.7, 2.5, 2.6, 2.7_

- [x] 18. Fix SEC-005: `is_admin()` helper + rewrite the IN-SCOPE policies only
  - Create `supabase/migrations/20240105_sec005_is_admin_helper_and_policies.sql`: `create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public` returning `exists(select 1 from public.users where id = auth.uid() and role = 'admin')`; `revoke all … from public`; `grant execute … to authenticated, anon`
  - Rewrite ONLY the three in-scope policies to `public.is_admin()`: `"Admins: all users"` (ON `users` — the one truly recursive policy), `"AuditLog: admin read"` (ON `audit_log`), and the `pages` admin policy
  - **Explicit scope decision:** do NOT touch the ~10 cross-table admin policies that subquery `users` from a different table (Categories, CatTrans, Products, ProdTrans, ProdImages, ProdCats, Coupons admin-all, CouponUsages, Orders, OrderItems, Comments admin-all) — they are fragile-but-not-recursive and out of AC 2.5 scope; record them as an optional consistency follow-up, do not silently drop them
  - [x] 18.1 Live-schema reconciliation BEFORE drop (2.10)
    - Dump live policy names on `users`, `audit_log`, `pages`; confirm the exact `pages` admin policy name and the `users`/`audit_log` admin policy names match the `drop` targets (checked-in `create_pages.sql` may differ from live)
    - _Requirements: 2.10_
  - [x] 18.2 Apply + reconcile AFTER (2.10)
    - Re-dump: confirm no policy ON `users` queries `users`, the three policies now use `public.is_admin()`, and `is_admin()` is `security definer stable`; mirror into `supabase/schema.sql` (add `is_admin()` after extensions/before policies; rewrite the three policies)
    - _Requirements: 2.10_
  - _Bug_Condition: table ∈ {users, audit_log, pages} ∧ policyUsesInlineUsersSubquery=true_
  - _Expected_Behavior: policies use public.is_admin(); no policy on users queries users; direct authenticated select raises no recursion error; admin/non-admin decisions preserved_
  - _Preservation: non-recursive own-row policies + service-role bypass unchanged [3.5]_
  - _Design: Property 5_
  - _Requirements: 2.5, 2.10, 3.5_

- [x] 19. Fix SEC-006: `getAdminSupabase()` fail-fast + boot assertion
  - In `artifacts/api-server/src/lib/supabase.ts`, change `getAdminSupabase()` to `throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")` when `serviceKey` is unset; remove the `serviceKey || anonKey` fallback; keep the service-role client (no autoRefresh, no persistSession) when set
  - Add an eager startup assertion in `src/index.ts` (or assert `serviceKey` in the api-server `resolveSupabaseEnv()`): call `getAdminSupabase()` once during boot so the process exits **before** `listen()` when the key is missing
  - [x] 19.1 Rollout guard: confirm the service-role key is present everywhere the fail-fast will run
    - Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in ALL deploy targets BEFORE this fail-fast change ships — Vercel (api-server project env) AND the Railway api-server environment — so the new hard throw does not take down a previously-working environment
    - Confirm the api-server test setup provides `SUPABASE_SERVICE_ROLE_KEY` (or mocks `getAdminSupabase`) so the new throw does not break the unit suite (`pnpm run test`)
    - _Requirements: 2.6, 3.6_
  - _Bug_Condition: context='api-server-startup' ∧ env.SUPABASE_SERVICE_ROLE_KEY=UNSET_
  - _Expected_Behavior: boot throws/exits, never an anon "admin" client_
  - _Preservation: when key is set, returns a service-role client identical to today [3.6]_
  - _Design: Property 6_
  - _Requirements: 2.6, 3.6_

- [x] 20. Fix SEC-007: remove control-plane credential from bundle + deny-by-default assertion + document coordination
  - [x] 20.1 Remove `VITE_CONTROL_PLANE_*` from `vercel.json`
    - Remove `VITE_CONTROL_PLANE_SUPABASE_URL` and `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` from the storefront build config in `vercel.json` so they are not bundled
    - _Requirements: 2.7_
  - [x] 20.2 Add the control-plane deny-by-default assertion migration
    - Create `supabase/control-plane/migrations/009_assert_deny_by_default.sql`: a `do $$ … $$` block that raises if any `public` control-plane table has RLS disabled or if any policy exists on the `public` schema
    - Live-schema reconciliation (2.10): run against the live control-plane DB; confirm RLS enabled + zero policies on control-plane tables (e.g. `stores`); the migration self-fails otherwise
    - _Requirements: 2.7, 2.10_
  - [x] 20.3 Document the `super-admin-platform` coordination — do NOT delete `lib/platform/client.ts`
    - Record (in design/spec notes) that `artifacts/store/src/lib/platform/client.ts` belongs to the separate `super-admin-platform` feature; the chosen resolution is to route `/platform/*` flows behind API-server control-plane endpoints (service role) under that spec
    - **Do not unilaterally delete `client.ts`**; the enforceable browser-side guarantee here is the credential removal (20.1) — note the explicit cross-spec dependency
    - _Requirements: 2.7_
  - _Bug_Condition: artifact='storefront-bundle' ∧ containsControlPlaneCredential=true_
  - _Expected_Behavior: no control-plane credential in bundle; control-plane access API-server-only OR residual usage documented; tables deny-by-default_
  - _Preservation: normal storefront store-DB anon access unchanged [3.7]_
  - _Design: Property 7_
  - _Requirements: 2.7, 2.10, 3.7_

- [x] 21. Verify P2 fixes (Fix-Checking + Preservation re-run)
  - [x] 21.1 Re-run / extend P2 checks on FIXED code
    - **Property 5: Expected Behavior** - direct authenticated `select users`/`audit_log` raises no `42P17`; `is_admin()` true for admin, false for non-admin; admin write decisions unchanged
    - **Property 6: Expected Behavior** - `getAdminSupabase()` throws when key unset; boot assertion exits before `listen`; returns client when set
    - **Property 7: Expected Behavior** - bundle / `vercel.json` contains no `VITE_CONTROL_PLANE_*`; `009_assert_deny_by_default.sql` passes; live control-plane anon `select stores` → `[]`
    - _Requirements: 2.5, 2.6, 2.7_
  - [x] 21.2 Re-run P2 preservation checks
    - **Property 8: Preservation** - own-row policies (orders/cart/wishlist) yield identical decisions + service-role bypass unchanged [3.5]; `getAdminSupabase()` with key set identical to today [3.6]; storefront store-DB anon access unchanged, control-plane anon `select stores` → `[]` [3.7]
    - **EXPECTED OUTCOME:** PASS (no regressions)
    - _Requirements: 3.5, 3.6, 3.7_
  - [x] 21.3 Typecheck + build + unit gate for P2-touched code
    - Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run test` (unit gate) for the P2-touched code (`artifacts/api-server/src/lib/supabase.ts`, `artifacts/api-server/src/index.ts`) so TS/build errors surface per-band instead of only at the final gate (task 24)
    - _Requirements: 2.6, 3.6_

#### P2 tests

- [x] 22. Unit tests for SEC-006 / SEC-007 (vitest, no DB)
  - `getAdminSupabase()`: with `SUPABASE_SERVICE_ROLE_KEY` unset → throws `"SUPABASE_SERVICE_ROLE_KEY is required"`; with it set → returns a client, no anon fallback (mock env) (Fix-Checking + Preservation, Property 6 [3.6])
  - Boot assertion: server exits before `listen()` when the key is missing (Fix-Checking, Property 6)
  - Bundle / `vercel.json` credential absence: assert no `VITE_CONTROL_PLANE_*` key present (Fix-Checking, Property 7)
  - Structural migration assertion: SEC-005 migration defines `is_admin()` `security definer stable` and rewrites exactly the three in-scope policies (Fix-Checking, Property 5)
  - _Requirements: 2.5, 2.6, 2.7_

- [x] 23. RLS-level integration tests for SEC-005 + control-plane deny-by-default (CI `integration-e2e`)
  - SEC-005: direct authenticated `select users`/`audit_log` → no `42P17`; `is_admin()` returns true/false correctly; admin/non-admin access decisions preserved (Fix-Checking + Preservation, Property 5 [3.5])
  - SEC-007: `009_assert_deny_by_default.sql` passes (RLS on, zero policies); live control-plane anon `select stores` → `[]` (Fix-Checking + Preservation, Property 7 [3.7])
  - _Requirements: 2.5, 2.7, 3.5, 3.7_

---

### Pre-release gate

- [x] 24. Walk the security-report Section 8 Security Regression Checklist as the pre-release gate
  - Confirm every checklist item maps to a passing test/assertion above before release: SEC-001 role-write rejected + `requireAdmin` 403 (all three defenses present); SEC-002 `size_guides` client write `42501`; SEC-003 anon `coupons` empty + admin list via `GET /admin/coupons`; SEC-004 `approved=true` insert rejected; SEC-005 no recursion + `is_admin()` decisions; SEC-006 fail-fast on missing key; SEC-007 no `VITE_CONTROL_PLANE_*` in bundle + deny-by-default
  - Confirm Preservation (Property 8) holds: all service-role ops unchanged, profile edits + admin coupon list + coupon validation + moderation flow intact
  - Confirm 2.10 reconciliation completed for every migration (live before/after dumps recorded, `supabase/schema.sql` mirrored, `@workspace/supabase-types` regenerated if needed)
  - Run `pnpm run typecheck`, `pnpm run build`, `pnpm run test` (unit gate) and the `integration-e2e` job; resolve any failure before release
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

---

## Notes

- Tasks marked with `*` are optional / test-only (per the repo convention) and gate quality, not shippability of the fix itself.
- Bands are strictly ordered **P0 → P1 → P2** so each is independently shippable; each band's exploration + preservation tasks run on the code state before that band's fixes.
- Every SQL migration carries a live-schema reconciliation sub-step (2.10): dump/verify live policy/grant/trigger names before `drop`, re-verify after apply, then mirror into `supabase/schema.sql` (regenerate `@workspace/supabase-types` if column types changed).
- Each PBT/property task carries exactly one `**Property N: …**` marker (design Properties 1–8) so hover status resolves; tests are tagged Fix-Checking vs Preservation.
- DOM tests (LoginModal, CouponsPage) run in jsdom and assert behavior (call `userFetch`/`adminFetch`, make no direct Supabase client read/write) — never regex on source.
- RLS-level assertions run in the CI `integration-e2e` job (Supabase, anon + service-role keys) because the policy itself is the assertion and cannot be unit-tested.
- Service-role (API server) operations are `¬C` for every finding and must remain byte-for-byte unchanged (Property 8).
- SEC-005 is maintainability/fragility hardening (did not reproduce live); the ~10 cross-table admin policies are an explicit, documented out-of-scope follow-up — do not silently drop them.
- SEC-007 does not delete `lib/platform/client.ts`; the enforceable browser guarantee is credential removal, with the `super-admin-platform` routing change coordinated under that spec.
- **Atomic deploy units (auto-deploy from `main`):** Task 12's sub-steps ship as ONE unit and in order — add `GET /admin/coupons` (12.1) → re-route `CouponsPage` (12.2) → drop the public-read policy (12.3) → reconcile (12.4) — so the admin coupon list is never broken. Likewise task 5's `LoginModal` re-route (5.3) + profile hardening (5.1/5.2) land together-with-or-before the SEC-001 lockdown (task 4) so customer profile writes never hit a broken window (the `PATCH /profile` service-role path already works; only the `LoginModal` direct anon write is at risk).
- **Per-band typecheck/build gate:** the per-band verify tasks (6.3, 14.3, 21.3) run `pnpm run typecheck` + `pnpm run build` + `pnpm run test` for that band's touched code (P0: `profile.ts`, `LoginModal.tsx`; P1: `admin/coupons.ts`, `CouponsPage.tsx`; P2: `lib/supabase.ts`, `index.ts`) so TS/build errors surface per-band, not only at the final gate (task 24, which stays the full gate).
- **SEC-006 rollout guard (19.1):** the fail-fast throw is only safe once `SUPABASE_SERVICE_ROLE_KEY` is confirmed present in every deploy target (Vercel + Railway api-server) and the api-server test setup supplies it (or mocks `getAdminSupabase`), so the hard throw never takes down a previously-working environment or breaks the unit suite.
- **Middleware/resolver precision (clarifying only):** the `requireAdmin` Express middleware in `src/middlewares/requireAdmin.ts` delegates to the legacy `resolveAdmin` (`requireAdmin(req)`) in `lib/supabase.ts` — they share logic (one wraps the other), so wiring either keeps the `users.role` trust chain correct. No task behavior changes from this note.

## Task Dependency Graph

ASCII view (priority bands + parallelism within each band):

```
PRE-FLIGHT (P0 gate)
  1  Verify trigger claim expr vs LIVE DB ──┐ (must pass before task 4)
P0 band (Critical — ship first)            ▼
  2* Explore SEC-001 ──┐
  3* Preserve baseline ─┤ (run on unfixed code)
                        ▼
  4  Fix SEC-001 migration   ┐ 4 ∥ 5 (DB vs api-server/store)
  5  Fix SEC-008 endpoint     ┘
  6  Verify P0           depends on 4 & 5
  7* P0 unit/property ┐ depends on 4 & 5
  8* P0 RLS integ.    ┘ 7 ∥ 8
P1 band (High — after P0)
  9*  Explore ──┐ 10* Preserve baseline ─┐ (before fixes)
                                         ▼
  11 SEC-002 ∥ 12 SEC-003 ∥ 13 SEC-004 (independent objects/files)
  14 Verify P1   depends on 11,12,13
  15* unit ∥ 16* RLS integ.
P2 band (Medium→Low — last)
  17* Explore/observe
  18 SEC-005 ∥ 19 SEC-006 ∥ 20 SEC-007 (independent: SQL / api-server / config+control-plane)
  21 Verify P2   depends on 18,19,20
  22* unit ∥ 23* RLS integ.
PRE-RELEASE GATE
  24 Section 8 Regression Checklist   depends on ALL of 4–23
```

Machine-readable wave definitions (each wave runs after the previous; tasks within a wave may run in parallel):

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4", "5"] },
    { "id": 3, "tasks": ["6", "7", "8"] },
    { "id": 4, "tasks": ["9", "10"] },
    { "id": 5, "tasks": ["11", "12", "13"] },
    { "id": 6, "tasks": ["14", "15", "16"] },
    { "id": 7, "tasks": ["17"] },
    { "id": 8, "tasks": ["18", "19", "20"] },
    { "id": 9, "tasks": ["21", "22", "23"] },
    { "id": 10, "tasks": ["24"] }
  ]
}
```

**Parallelism notes**
- Within P0, tasks 4 (SEC-001 migration) and 5 (SEC-008 endpoint) touch different layers (DB vs api-server/store) and run in parallel after the task-1 pre-flight gate; both must land before P0 verification (task 6). **Deploy-coupling caveat:** although 4 ∥ 5 may be *developed* in parallel, in *deployment* task 5's client re-route (5.3) + profile hardening (5.1/5.2) MUST ship together-with-or-before task 4's users-write lockdown, else customer profile writes break in the gap (the `PATCH /profile` service-role path already works; only the `LoginModal` direct anon write is at risk).
- Within each band the three fixes operate on independent DB objects / files and run in parallel; verify + `*` test tasks fan out once the band's fixes land. **Exception:** task 12's own sub-steps are NOT independent — the `GET /admin/coupons` endpoint (12.1) and the `CouponsPage` re-route (12.2) MUST land before the public-read policy drop (12.3) takes effect, and all four sub-steps ship as one atomic unit so the admin coupon list is never broken.
- Bands are strictly ordered P0 → P1 → P2 for independent shippability.
- Task 24 is the single pre-release gate and depends on every prior task.
