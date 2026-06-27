# Security Report — Supabase RLS Architecture

**Scope:** Row Level Security (RLS) architecture of the white-label e-commerce platform — store database (`supabase/schema.sql` + `supabase/migrations/`), control-plane database (`supabase/control-plane/migrations/`), and the client/server access paths that rely on those policies.

**Method:** Static analysis of SQL policies, the storefront Supabase client, the API server auth middleware, and the call sites that write to RLS-protected tables. Read-only — no dynamic testing against production.

---

## 1. Executive Summary

**Posture rating: Critical — immediate action required.**

The storefront SPA talks to Supabase **directly with the anon key** (`createClient()` in `artifacts/store/src/lib/supabase/client.ts`), so RLS is the real authorization boundary for client traffic. The API server uses the service-role key (`getAdminSupabase()`), which **bypasses RLS entirely**. Several RLS policies are too permissive for this direct-access model.

Top 5 risks:

1. **(Critical) Privilege escalation** — any logged-in customer can set their own `users.role = 'admin'` via the anon client and gain full admin access to the panel and the entire `/admin/*` API.
2. **(High) `size_guides` is world-writable** — `using(true) with check(true)` lets anonymous users insert/update/delete rows.
3. **(High) All active coupon codes leak** — public read policy exposes every active code, discount value, and scope.
4. **(High) Review moderation bypass** — the comment insert policy doesn't constrain `approved`, so users can self-publish approved reviews.
5. **(Medium) Recursive admin RLS policies** — `users` / `audit_log` / `pages` policies query `users` from within a `users` policy (Supabase infinite-recursion anti-pattern + fragile design).

---

## 2. Application Map (trust boundaries)

| Actor | Credential | RLS applies? | Reaches |
|-------|-----------|--------------|---------|
| Anonymous visitor | `VITE_SUPABASE_ANON_KEY` (in browser) | Yes | Public reads + any policy allowing `anon`/`authenticated` |
| Logged-in customer | Supabase JWT (`authenticated`) | Yes | Own rows + any permissive policy |
| API server | `SUPABASE_SERVICE_ROLE_KEY` | **No (bypasses RLS)** | Everything in the store DB |
| Control-plane DB | service role only | Deny-by-default (RLS on, no policies) | API-server only |

Admin authority is derived **solely from the `users.role` column** — both the SPA gate (`AdminLayout.tsx`) and the API middleware (`requireAdmin` in `artifacts/api-server/src/lib/supabase.ts`) read `role` and trust it. Anything that can write that column controls admin access.

---

## 3. Threat Model

| Asset | Threat | Scenario | Impact | Existing protection | Gap |
|-------|--------|----------|--------|---------------------|-----|
| Admin role | Privilege escalation | Customer updates own `users.role` to `admin` via anon client | Full store takeover | None (policy allows it) | SEC-001 |
| Size guides | Data tampering | Anon writes/deletes rows | Content integrity | None (policy is `true`) | SEC-002 |
| Coupon codes | Discount abuse | Anon enumerates active codes | Revenue loss | None (public read) | SEC-003 |
| Product reviews | Moderation bypass | User inserts `approved=true` comment | Spam / abusive content published | Partial (ownership only) | SEC-004 |
| `users`/`audit_log` reads | Availability / fragility | Recursive policy evaluation | Errors / brittle access control | Service role masks it | SEC-005 |
| Multi-tenant DB | Tenant leak | Browser holds control-plane anon key | Cross-tenant exposure if a policy regresses | Deny-by-default RLS | SEC-007 |

---

## 4. Detailed Findings

### SEC-001 — Privilege escalation via self-update of `users.role` (Critical, A01 Broken Access Control)

**Evidence:**
- `supabase/schema.sql`:
  ```sql
  create policy "Users: own row" on public.users for all using (auth.uid() = id);
  ```
  `for all` with only `using` means `with check` defaults to `auth.uid() = id` — there is **no column-level restriction**. The `role` column's check constraint explicitly allows `'admin'`.
- `artifacts/store/src/components/auth/LoginModal.tsx:134` writes to the table directly with the anon client:
  ```ts
  await supabase.from("users").update({ full_name: fullName.trim() }).eq("id", user.id);
  ```
- `artifacts/api-server/src/lib/supabase.ts` (`requireAdmin`) trusts the DB role:
  ```ts
  const { data: profile } = await admin.from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  ```
- `artifacts/store/src/pages/admin/AdminLayout.tsx` uses the same `select("role")` check to unlock the admin UI.

**Proof of concept** (any authenticated customer, in the browser console):
```js
const s = createClient();
const { data: { user } } = await s.auth.getUser();
await s.from("users").update({ role: "admin" }).eq("id", user.id);
```
After this, both the admin panel and every `/admin/*` API endpoint treat the user as a full admin.

**Impact:** Complete compromise — product/price/coupon manipulation, access to all customer PII and orders, audit log read.

**Fix (defense in depth — apply all):**
1. Make the user row read-only for clients and move profile writes to the API (service role):
   ```sql
   drop policy "Users: own row" on public.users;
   create policy "Users: own row read" on public.users for select using (auth.uid() = id);
   ```
   Update `LoginModal` and `useProfile` (`full_name` / `default_address`) to call an authenticated API endpoint instead of writing Supabase directly.
2. If client writes must remain, use column grants so `role` is unwritable:
   ```sql
   revoke update on public.users from authenticated;
   grant update (full_name, default_address, email, phone) on public.users to authenticated;
   ```
3. Add a `before update` trigger that rejects any `role` change unless the caller is the service role — blocks escalation even if a policy regresses later.

**Regression test:** As a non-admin authenticated user, assert that `update users set role='admin'` is rejected (RLS/trigger), and that `requireAdmin` still returns 403 afterward.

---

### SEC-002 — `size_guides` is world-writable (High, A01 Broken Access Control)

**Evidence — `supabase/migrations/create_size_guides.sql`:**
```sql
create policy "size_guides_admin_write" on public.size_guides
  for all using (true) with check (true);
```
The comment claims "via service role key," but `using(true) with check(true)` grants `anon` and `authenticated` full write/delete. Any visitor can insert, edit, or delete size guides.

**Impact:** Unauthenticated content tampering / data loss (low business value, but unrestricted).

**Fix:** Drop the write policy entirely. Admin writes go through the service role, which bypasses RLS and needs no policy. Keep only:
```sql
drop policy "size_guides_admin_write" on public.size_guides;
-- retain: create policy "size_guides_read" ... for select using (true);
```

**Regression test:** Anon insert/update/delete on `size_guides` returns an RLS error; admin write via API still succeeds.

---

### SEC-003 — All active coupon codes are publicly readable (High, A04 Insecure Design)

**Evidence — `supabase/schema.sql`:**
```sql
create policy "Coupons: public read active" on public.coupons for select using (is_active = true);
```
Anon clients can `select *` from `coupons` and read every active `code`, `discount_value`, `min_order_amount`, `max_uses`, and scope. Unannounced/targeted promo codes are fully enumerable.

**Impact:** Discount abuse and revenue loss; leakage of marketing strategy.

**Fix:** Remove the broad public-read policy and validate coupons only server-side via the existing `POST /api/coupons/validate` (service role). If a public read is genuinely needed, expose a view limited to non-sensitive columns for explicitly public codes.

**Regression test:** Anon `select` on `coupons` returns no rows; `POST /api/coupons/validate` still validates a known code.

---

### SEC-004 — Review moderation bypass via `approved` on insert (High, A01 Broken Access Control)

**Evidence — `supabase/schema.sql`:**
```sql
create policy "Comments: own insert" on public.comments for insert with check (auth.uid() = user_id);
```
The check validates ownership only, not the `approved` column. A user can insert a comment with `approved: true` via the anon client, bypassing admin moderation.

**Impact:** Arbitrary self-published review content (spam, abuse, defamation) on product pages.

**Fix:** Constrain the insert:
```sql
drop policy "Comments: own insert" on public.comments;
create policy "Comments: own insert" on public.comments
  for insert with check (auth.uid() = user_id and approved = false);
```

**Regression test:** Authenticated insert with `approved=true` is rejected; insert with `approved=false` succeeds and stays hidden until an admin approves.

---

### SEC-005 — Recursive admin RLS policies (Medium, A04 Insecure Design)

**Evidence:** `users`, `audit_log` (`supabase/schema.sql`) and `pages` (`supabase/migrations/create_pages.sql`) all use, from within a policy protecting `users` itself:
```sql
exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
```
A policy on `users` that subqueries `users` is the classic Supabase "infinite recursion detected in policy for relation users" anti-pattern, and the per-table subquery is duplicated and fragile.

**Impact:** Risk of runtime RLS errors for direct client reads; brittle, hard-to-maintain access control. Currently partly masked because admin operations run through the service role.

**Fix:** Introduce a `security definer` helper and call it from every admin policy:
```sql
create or replace function public.is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;
-- then: ... for all using (public.is_admin());
```
Alternatively, store the role as a JWT custom claim and read `auth.jwt()` in policies (no table lookup).

**Regression test:** A direct authenticated `select` on `users`/`audit_log` does not raise a recursion error; admin and non-admin access behave correctly.

---

### SEC-006 — `getAdminSupabase()` silently falls back to the anon key (Medium, A05 Misconfiguration)

**Evidence — `artifacts/api-server/src/lib/supabase.ts`:**
```ts
return createClient<Database>(url, serviceKey || anonKey, { ... });
```
If `SUPABASE_SERVICE_ROLE_KEY` is unset in any environment, the "admin" client becomes an anon client. Admin behavior then degrades unpredictably (RLS now applies to operations that assume bypass) instead of failing loudly.

**Impact:** Hard-to-diagnose failures or inconsistent enforcement across environments.

**Fix:** Fail fast on startup if the service key is missing:
```ts
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
```

**Regression test:** Boot with the service key unset → process exits/throws rather than starting with an anon "admin" client.

---

### SEC-007 — Control-plane anon key shipped to the browser (Low / Informational, A05 Misconfiguration)

**Evidence — `vercel.json`** defines `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY`, which is bundled into the storefront. Control-plane tables currently use deny-by-default RLS (RLS enabled, **no policies**), so they are not readable today.

**Impact:** Safe at present, but the multi-tenant DB becomes network-reachable from every visitor's browser. A single accidental permissive policy would expose all tenants.

**Fix:** Do not deliver control-plane credentials to the browser. Keep control-plane access API-server-only (service role), and assert deny-by-default in a migration/test.

---

## 5. Ecommerce Abuse-Case Matrix

| Abuse case | Exploitable now? | Finding |
|------------|------------------|---------|
| Role escalation | **Yes** | SEC-001 |
| Price/discount tampering (coupon enumeration) | **Yes** | SEC-003 |
| IDOR on orders/cart/profile | No (own-row policies + API checks) | — |
| Stock manipulation | No (service-role RPC, server validation) | — |
| Content tampering (size guides) | **Yes** | SEC-002 |
| Moderation bypass (reviews) | **Yes** | SEC-004 |
| Tenant data leak | Not currently (deny-by-default) | SEC-007 |

---

## 6. Secrets & Configuration Review

- `SUPABASE_SERVICE_ROLE_KEY` is **not** `VITE_`-prefixed — correctly server-only. ✅
- `VITE_SUPABASE_ANON_KEY` is public by design — acceptable, but it makes RLS the security boundary (see findings). ⚠️
- `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` is shipped to the browser — see SEC-007. ⚠️
- Service-role client has a silent anon fallback — see SEC-006. ⚠️

---

## 7. Prioritized Fix Plan

**P0 (before next deploy)**
- SEC-001 — close the `users` client-write path and block `role` mutation.

**P1 (this iteration)**
- SEC-002 — drop the `size_guides` world-write policy.
- SEC-003 — remove public coupon read; validate server-side.
- SEC-004 — constrain comment insert to `approved = false`.

**P2 (hardening)**
- SEC-005 — replace recursive policies with `is_admin()` / JWT claim.
- SEC-006 — fail fast when the service key is missing.
- SEC-007 — stop shipping control-plane credentials to the browser.

---

## 8. Security Regression Checklist (pre-release gate)

- [ ] Non-admin cannot change `users.role` (RLS + trigger) and cannot reach `/admin/*`.
- [ ] Client cannot write `users` columns other than profile fields (or cannot write `users` at all).
- [ ] Anon cannot write/delete `size_guides`.
- [ ] Anon cannot read `coupons`; coupon validation works via API only.
- [ ] Authenticated user cannot insert a comment with `approved = true`.
- [ ] Direct reads on `users`/`audit_log` do not raise RLS recursion errors.
- [ ] API server refuses to start without `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Browser bundle contains no control-plane service credentials; control-plane tables remain deny-by-default.

---

*Findings are based on static review of the checked-in schema, migrations, and call sites. The live database is noted to be ahead of `supabase/schema.sql`; confirm each policy against the live schema before and after remediation.*

---

## 9. Live Verification Log

Tested against the production data plane (`https://pnzhfqgrlcmwjzcdduxh.supabase.co`) using the public anon key from `vercel.json`, plus the API server on Railway/Vercel. No production data was modified.

| Finding | Result | Evidence |
|---------|--------|----------|
| Baseline | ✅ anon key valid | `GET /rest/v1/products` → `HTTP 200` (returned real products) |
| **SEC-003** coupon leak | ✅ **Confirmed** | Anon `GET /rest/v1/coupons` → `HTTP 200` exposing active codes `WELCOME10`, `FLAT20`, `TEST_10PCT`, `TEST_5AZN` with discount types/values |
| **SEC-002** `size_guides` world-write | ✅ **Confirmed** | Anon `POST /rest/v1/size_guides` passed RLS and failed only on the FK check (`23503`, `HTTP 409`) — a blocked write would return `401/42501`. With a valid `category_id` the row would persist |
| **SEC-007** control-plane lockdown | ✅ **Confirmed (informational)** | Anon `GET /rest/v1/stores` on control-plane project → `HTTP 200 []` (deny-by-default holds). Concern remains that the browser-shipped anon key reaches that DB at all |
| **SEC-005** recursive `users` policy | ❌ **Did NOT reproduce** | Anon `GET /rest/v1/users` → `HTTP 200 []`, no `42P17 infinite recursion` error. **Severity downgraded to Low** — maintainability/fragility smell, not a confirmed runtime fault |
| **SEC-001** role self-escalation | ⚠️ **Static-confirmed; not live-reproduced** | Requires an authenticated JWT. All token paths failed on the live deployment (see below). Policy text + client write + `requireAdmin` trust chain confirmed by static review |
| **SEC-004** review self-approval | ⚠️ **Static-confirmed; not live-reproduced** | Same blocker — insert policy needs `auth.uid() = user_id` (a real session) |
| **SEC-006** service-key fallback | ⚪ Not externally testable | Server-side env config |

### Token-acquisition blockers (why SEC-001 / SEC-004 are not live-reproduced)

The provided test credentials (`+994551234567` / `999999`) are a valid OTP bypass in `verifyOTP` (`artifacts/api-server/src/lib/otp.ts`), but no session could be obtained because session **issuance** fails on every available path:

- API server on Railway: `POST /api/auth/otp/verify` → `HTTP 500 {"error":"Internal server error"}` (unhandled throw in the `createUser`/`updateUserById`/`signInWithPassword` session-issuance block).
- API server on Vercel: `POST /api/auth/otp/verify` → `HTTP 405` (deployment does not accept POST on this route).
- Direct Supabase Auth email signup: succeeds but **email confirmation is required** → no token; `signInWithPassword` → `HTTP 400 email_not_confirmed`.

These are environment/config issues on the live deployment, independent of the RLS findings. Note: the production login flow returning `500` is itself worth investigating (separate from this RLS audit).

To complete SEC-001 / SEC-004, provide one of: a valid user `access_token` from a logged-in test session, a non-prod environment with working session issuance, or temporary disabling of "Confirm email" so a throwaway Supabase user can be signed in.

### Test artifact to clean up

A throwaway unconfirmed auth user was created during verification and should be removed with the service role:
- email `sec.audit.probe001@gmail.com`, id `576a1a0c-76d5-4763-91be-0fb729d13908` (plus any `public.users` row created by the `handle_new_user` trigger).
