# Bugfix Requirements Document

## Introduction

The storefront SPA communicates with Supabase directly using the public anon key, which makes Row Level Security (RLS) the real authorization boundary for all client traffic. The API server uses the service-role key and bypasses RLS entirely. A security audit (`security-report.md`) found that several RLS policies are too permissive for this direct-access model, producing one critical privilege-escalation defect and a set of related access-control, data-exposure, and misconfiguration defects.

This document treats each of the seven audit findings (SEC-001 through SEC-007) as a defect with a clearly stated bug condition, the current (incorrect) behavior, the expected (correct) behavior, and the existing behavior that must be preserved. It also captures two cross-cutting requirements that the firm remediation decisions introduce: (a) an authenticated profile-write API endpoint that replaces the dropped client write to `users`, and (b) a schema-migration delivery / live-schema reconciliation rule that applies to every fix. Each acceptance criterion is written so it maps to an item in the report's Section 8 Security Regression Checklist and can be verified before release.

**Severity / priority summary (from the report):**
- SEC-001 — Privilege escalation via `users.role` self-update (Critical, P0)
- SEC-002 — `size_guides` world-writable (High, P1) — confirmed live
- SEC-003 — All active coupon codes publicly readable (High, P1) — confirmed live (WELCOME10, FLAT20, TEST_10PCT, TEST_5AZN)
- SEC-004 — Review moderation bypass on comment insert (High, P1)
- SEC-005 — Recursive admin RLS policies (Medium → Low, P2) — did not reproduce live; treated as maintainability/fragility hardening
- SEC-006 — `getAdminSupabase()` silently falls back to anon key (Medium, P2)
- SEC-007 — Control-plane anon key shipped to the browser (Low/Informational, P2) — control-plane is deny-by-default today

**Out of primary scope (flagged, not remediated by this spec):**
- Cleanup of the throwaway verification auth user `sec.audit.probe001@gmail.com` (id `576a1a0c-76d5-4763-91be-0fb729d13908`) and any `public.users` row created by the `handle_new_user` trigger.
- Production login flow returning HTTP 500 on `POST /api/auth/otp/verify` (session-issuance failure) — separate from the RLS findings and should be investigated independently.

**Bug condition methodology note:** For each finding, the bug condition `C(X)` identifies the inputs/callers that trigger the defect (typically an `anon`/`authenticated` client acting through RLS, or a misconfigured environment). The fix `F'` must satisfy the expected-behavior property for all `C(X)`, while preserving identical behavior for all non-buggy inputs `¬C(X)` — most importantly, service-role (API server) operations, which bypass RLS, must remain unchanged.

## Bug Analysis

### Current Behavior (Defect)

These clauses describe what the system does today when each bug condition is met.

1.1 WHEN an authenticated (non-admin) customer issues `update users set role='admin' where id = auth.uid()` through the anon client THEN the system permits the write, because policy "Users: own row" is `for all using (auth.uid() = id)` with no column-level restriction, and `requireAdmin` / `AdminLayout` subsequently treat the user as a full admin (SEC-001).

1.2 WHEN an anonymous or authenticated client issues an `insert`, `update`, or `delete` on `size_guides` through the anon client THEN the system permits the write, because policy "size_guides_admin_write" is `for all using(true) with check(true)` (SEC-002).

1.3 WHEN an anonymous client issues `select` on `coupons` through the anon client THEN the system returns every active coupon's `code`, `discount_value`, `min_order_amount`, `max_uses`, and scope, because policy "Coupons: public read active" allows `select` for any row where `is_active = true` (SEC-003).

1.4 WHEN an authenticated user inserts a row into `comments` with `approved = true` through the anon client THEN the system accepts it and the review is published without admin moderation, because policy "Comments: own insert" checks only `auth.uid() = user_id` and does not constrain the `approved` column (SEC-004).

1.5 WHEN admin RLS policies on `users`, `audit_log`, and `pages` are evaluated THEN they each run a subquery `exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')` from within a policy that protects `users`, which is the Supabase infinite-recursion anti-pattern and is duplicated per table, making the access control fragile and hard to maintain (SEC-005).

1.6 WHEN the API server boots with `SUPABASE_SERVICE_ROLE_KEY` unset THEN `getAdminSupabase()` silently falls back to the anon key (`serviceKey || anonKey`), so the "admin" client becomes an anon client subject to RLS, causing unpredictable degradation instead of a loud failure (SEC-006).

1.7 WHEN the storefront bundle is built and served THEN it includes the control-plane anon key (`VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` from `vercel.json`), making the multi-tenant control-plane database network-reachable from every visitor's browser, so a single accidental permissive policy would expose all tenants (SEC-007). The storefront actively constructs a browser control-plane client in `artifacts/store/src/lib/platform/client.ts` using `VITE_CONTROL_PLANE_SUPABASE_URL` / `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY`, so removing the credential is not a no-op — it interacts with the separate `super-admin-platform` feature.

1.8 WHEN a customer sets their name in `LoginModal.tsx:134` (`full_name`) or updates their profile via `useProfile.ts` `updateProfile` (`full_name` / `default_address`) THEN the system writes those columns to `public.users` directly through the anon client, relying on the same permissive "Users: own row" `for all` policy that enables SEC-001 — i.e. profile writes share the client-write path that must be closed.

1.9 WHEN an admin opens the coupons admin page (`artifacts/store/src/pages/admin/CouponsPage.tsx`) THEN the system reads the `coupons` table directly via the anon client (`createClient().from("coupons").select("*")`), depending on the public-read policy "Coupons: public read active" to return rows — so removing that policy (SEC-003) would break the admin coupon list.

1.10 WHEN a fix is reasoned about against `supabase/schema.sql` THEN the checked-in schema may not match the live database, because the report notes the live database is ahead of `supabase/schema.sql`; reasoning about or applying a policy change from the checked-in schema alone risks acting on stale policy definitions.

### Expected Behavior (Correct)

These clauses describe what the system SHALL do once the fix is applied, for the same bug conditions above.

2.1 WHEN an authenticated (non-admin) customer attempts `update users set role='admin'` (or any change to `role`) through the anon client THEN the system SHALL reject the write, AND `requireAdmin` SHALL continue to return unauthorized (403) for that user. The remediation SHALL apply ALL THREE of the following defenses together (defense in depth — every one is mandatory; this is not an either/or choice). The criterion passes only when all three are present:
   (a) The `for all` "Users: own row" policy SHALL be replaced with a `select`-only policy (`auth.uid() = id`), so the client can no longer write the `users` table directly. The `full_name` / `default_address` profile writes currently in `LoginModal.tsx` and `useProfile.ts` SHALL move to the authenticated API endpoint defined in 2.8.
   (b) Column-level privileges SHALL ensure `role` is never client-writable: `revoke update on public.users from authenticated`, then `grant update` on the explicitly allowed profile columns only (`full_name`, `default_address`). The grant SHALL NOT include `role`, and SHALL NOT include `email` or `phone` (see 2.8 — email/phone are out of scope and are not client-writable).
   (c) A `before update` trigger SHALL reject ANY change to `role` unless the caller is the service role, so escalation is blocked even if a policy regresses later.

2.2 WHEN an anonymous or authenticated client attempts to `insert`, `update`, or `delete` on `size_guides` through the anon client THEN the system SHALL reject the write with an RLS error (e.g. `42501` / HTTP 401/403), because the world-write policy "size_guides_admin_write" SHALL be dropped and admin writes SHALL flow through the service role (which bypasses RLS).

2.3 WHEN an anonymous client attempts `select` on `coupons` through the anon client THEN the system SHALL return no rows (broad public-read policy removed), AND coupon validation SHALL be performed only server-side via `POST /api/coupons/validate` using the service role. IF a genuinely public read is required, it SHALL be limited to non-sensitive columns of explicitly public codes via a dedicated view.

2.4 WHEN an authenticated user attempts to insert a row into `comments` with `approved = true` through the anon client THEN the system SHALL reject it, because the insert policy SHALL be `with check (auth.uid() = user_id and approved = false)`. Inserts with `approved = false` SHALL succeed and remain hidden until an admin approves them.

2.5 WHEN admin RLS policies on `users`, `audit_log`, and `pages` are evaluated THEN they SHALL use a `security definer` helper `public.is_admin()` (or a JWT custom claim read via `auth.jwt()`) instead of an inline `users` subquery, so that no policy on `users` queries `users`, AND a direct authenticated `select` on `users` / `audit_log` SHALL NOT raise a recursion error, AND admin/non-admin access SHALL behave correctly.

2.6 WHEN the API server boots with `SUPABASE_SERVICE_ROLE_KEY` unset THEN the system SHALL fail fast (throw / exit on startup) rather than starting with an anon "admin" client.

2.7 WHEN the storefront bundle is built and served THEN it SHALL NOT contain any control-plane credentials, AND any storefront code path that uses the browser control-plane client (`artifacts/store/src/lib/platform/client.ts`) SHALL be reconciled: control-plane access SHALL move to API-server-only (service role), OR any residual browser control-plane usage SHALL be explicitly documented and justified. The control-plane database SHALL be asserted deny-by-default (RLS enabled, no policies) via a migration/test. Because `lib/platform/client.ts` belongs to the separate `super-admin-platform` feature, this criterion has an explicit dependency on the `super-admin-platform` spec, and the chosen resolution SHALL be coordinated with it.

2.8 WHEN a customer updates their profile (the replacement path for the dropped client write in 2.1(a)) THEN the system SHALL provide an authenticated profile-write API endpoint that:
   - is protected by the `requireUser` Express middleware;
   - writes ONLY the caller's own row, deriving the target id from `req.user` / `req.authUser` so the request cannot target another user's id;
   - accepts a whitelist of profile fields of `full_name` and `default_address` ONLY;
   - explicitly rejects or ignores any attempt to set `role` (or any non-whitelisted column, including `email` and `phone`);
   - validates the request body via the project's Zod `validate(schema)` middleware (`src/middlewares/validate.ts`).
   The existing client writes at `LoginModal.tsx:134` (`full_name`) and `useProfile.ts` `updateProfile` (`full_name` / `default_address`) SHALL be re-routed to call this endpoint instead of writing Supabase directly.

2.9 WHEN an admin opens the coupons admin page THEN the coupons list SHALL be read through an admin API endpoint backed by the service role and protected by `requireAdmin`, so the list keeps working after the public-read policy is removed (2.3). The system SHALL NOT add any public coupon-read view as a workaround; `CouponsPage.tsx` SHALL no longer read the `coupons` table directly via the anon client.

2.10 WHEN any fix in this spec is delivered THEN it SHALL be implemented as a SQL migration under `supabase/migrations/` and reflected in `supabase/schema.sql`, AND each affected policy SHALL be reconciled/verified against the LIVE database both before and after remediation (the live database is the source of truth for what policy currently exists, since it is ahead of the checked-in schema).

### Unchanged Behavior (Regression Prevention)

These clauses describe existing behavior that MUST continue to work after the fix. The unifying principle is that service-role (API server) operations bypass RLS and must be unaffected, and legitimate client reads/writes for non-buggy inputs must be preserved.

3.1 WHEN the API server (service role) reads or writes the `users` table — including `requireAdmin` reading `users.role`, profile updates routed through the new authenticated API endpoint, and `AdminLayout` unlocking the UI for a genuine admin — THEN the system SHALL CONTINUE TO function correctly, and a legitimate customer SHALL CONTINUE TO be able to update their own `full_name` and `default_address`.

3.2 WHEN an admin updates `size_guides` through the API server (service role) THEN the system SHALL CONTINUE TO allow the write, AND public `select` reads of `size_guides` SHALL CONTINUE TO succeed (the read policy is retained).

3.3 WHEN `POST /api/coupons/validate` is called with a known valid code (e.g. WELCOME10) THEN the system SHALL CONTINUE TO validate the coupon and return the correct discount, AND coupon math via `lib/coupon-calc.ts` `calculateDiscount()` SHALL CONTINUE TO behave identically.

3.4 WHEN an authenticated user inserts a comment with `approved = false`, and WHEN an admin later approves and reads comments through the service role THEN the system SHALL CONTINUE TO accept the insert, keep it hidden until approval, and allow admin moderation as before.

3.5 WHEN any RLS policy that does not involve the recursive admin subquery is evaluated (own-row policies on orders, cart, profile reads, etc.) THEN the system SHALL CONTINUE TO enforce the same access decisions, and admin operations through the service role SHALL CONTINUE TO bypass RLS unchanged.

3.6 WHEN the API server boots with `SUPABASE_SERVICE_ROLE_KEY` correctly set THEN `getAdminSupabase()` SHALL CONTINUE TO return a service-role client that bypasses RLS exactly as it does today.

3.7 WHEN the storefront performs its normal reads/writes against the store database with `VITE_SUPABASE_ANON_KEY` THEN the system SHALL CONTINUE TO work unchanged, AND an anonymous `select` on control-plane tables (e.g. `stores`) SHALL CONTINUE TO return no rows (deny-by-default holds).

3.8 WHEN a legitimate customer updates their own `full_name` and/or `default_address` through the authenticated profile-write endpoint (2.8) THEN the system SHALL CONTINUE TO accept and persist those changes, so the profile-editing experience in `LoginModal` and `useProfile` keeps working after the direct client write is removed.

3.9 WHEN an admin opens the coupons admin page after the public-read policy is removed THEN the page SHALL CONTINUE TO display the coupon list (now served via the admin API endpoint in 2.9) exactly as it does today.

---

## Bug Condition Derivation

### SEC-001 — Privilege escalation via `users.role` self-update

```pascal
FUNCTION isBugCondition(X)
  INPUT: X = { caller, table, operation, columns }
  OUTPUT: boolean

  RETURN X.caller = 'authenticated'        // anon-client JWT, not service role
     AND X.table = 'users'
     AND X.operation = 'UPDATE'
     AND 'role' IN X.columns
END FUNCTION
```

```pascal
// Property: Fix Checking — role is immutable from the client (all three defenses required)
FOR ALL X WHERE isBugCondition(X) DO
  result ← apply'(X)
  ASSERT result = REJECTED            // (c) before-update trigger rejects any role change off service role
  ASSERT requireAdmin(X.caller) = 403 // trust chain still denies admin
END FOR

// Structural assertions — all three mechanisms must be present together
ASSERT usersWritePolicy'() = 'SELECT only (auth.uid() = id)'   // (a) client cannot write users
ASSERT clientUpdateGrant'('users') = { full_name, default_address }  // (b) role/email/phone excluded
ASSERT roleChangeTrigger'() = 'reject unless service role'     // (c) trigger present

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT apply(X) = apply'(X)         // service-role writes unchanged
END FOR
// Profile writes (full_name / default_address) are not dropped — they move to the 2.8 endpoint
ASSERT profileUpdate'(caller, { full_name, default_address }) = ACCEPTED  // via requireUser API endpoint, own row only
```

### SEC-002 — `size_guides` world-writable

```pascal
FUNCTION isBugCondition(X)
  RETURN X.caller IN { 'anon', 'authenticated' }
     AND X.table = 'size_guides'
     AND X.operation IN { 'INSERT', 'UPDATE', 'DELETE' }
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT apply'(X) = REJECTED                 // RLS error 42501 / 401 / 403
END FOR
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT apply(X) = apply'(X)                 // service-role writes + public reads unchanged
END FOR
```

### SEC-003 — Active coupon codes publicly readable

```pascal
FUNCTION isBugCondition(X)
  RETURN X.caller = 'anon'
     AND X.table = 'coupons'
     AND X.operation = 'SELECT'
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT apply'(X) = EMPTY_RESULT             // no rows via anon client
END FOR
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT validateCoupon'(code) = validateCoupon(code)  // server-side validation unchanged
END FOR
// Preservation — admin coupon list keeps working via the service-role admin API (no public view added)
ASSERT adminCouponList'() = readVia('admin API endpoint', requireAdmin, service_role)
ASSERT adminCouponList'() ≠ readVia('anon client', 'coupons')   // CouponsPage no longer reads coupons directly
ASSERT publicCouponView'() = NONE              // no public coupon-read view introduced
```

### SEC-004 — Review moderation bypass on insert

```pascal
FUNCTION isBugCondition(X)
  RETURN X.caller = 'authenticated'
     AND X.table = 'comments'
     AND X.operation = 'INSERT'
     AND X.row.approved = true
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT apply'(X) = REJECTED                 // check (auth.uid() = user_id AND approved = false)
END FOR
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT apply(X) = apply'(X)                 // approved=false inserts + admin moderation unchanged
END FOR
```

### SEC-005 — Recursive admin RLS policies

```pascal
FUNCTION isBugCondition(X)
  RETURN X.table IN { 'users', 'audit_log', 'pages' }
     AND policyUsesInlineUsersSubquery(X.policy) = true
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT policyUses'(X) = 'public.is_admin()' OR policyUses'(X) = 'auth.jwt() claim'
  ASSERT directAuthenticatedSelect'(X.table) ≠ RECURSION_ERROR
END FOR
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT accessDecision(X) = accessDecision'(X)  // admin & non-admin outcomes preserved
END FOR
```

### SEC-006 — Service-key silent fallback

```pascal
FUNCTION isBugCondition(X)
  RETURN X.context = 'api-server-startup'
     AND X.env.SUPABASE_SERVICE_ROLE_KEY = UNSET
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT boot'(X) = THROW_OR_EXIT             // fail fast, never anon "admin" client
END FOR
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT getAdminSupabase'(X) = service_role_client   // unchanged when key is set
END FOR
```

### SEC-007 — Control-plane credentials in the browser

```pascal
FUNCTION isBugCondition(X)
  RETURN X.artifact = 'storefront-bundle'
     AND containsControlPlaneCredential(X) = true
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT containsControlPlaneCredential'(X) = false   // not shipped to browser
  ASSERT controlPlaneRLS'() = 'deny-by-default'       // asserted via migration/test
END FOR
// Reconciliation of the browser control-plane client (lib/platform/client.ts)
ASSERT controlPlaneAccess'() = 'api-server-only (service role)'
    OR residualBrowserUsage'() = DOCUMENTED_AND_JUSTIFIED   // depends on super-admin-platform spec
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT storefrontStoreDbAccess(X) = storefrontStoreDbAccess'(X)  // normal anon access unchanged
END FOR
```
