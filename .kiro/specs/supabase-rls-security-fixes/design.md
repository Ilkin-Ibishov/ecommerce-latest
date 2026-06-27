# Supabase RLS Security Fixes Bugfix Design

## Overview

The storefront SPA talks to Supabase **directly with the anon key**, so Row Level Security (RLS) is the real authorization boundary for all browser traffic. The API server uses the **service-role key** (`getAdminSupabase()`), which bypasses RLS entirely. A static + live security audit (`security-report.md`) found one critical privilege-escalation defect and six related access-control / data-exposure / misconfiguration defects (SEC-001 … SEC-007), plus two cross-cutting requirements the firm remediation introduces: an authenticated profile-write endpoint (SEC-008/2.8) and a migration-delivery + live-schema reconciliation rule (2.10).

The remediation strategy is **closing the client-write surface at the database layer** (RLS policies, column grants, a role-immutability trigger, a `security definer` admin helper) while keeping all legitimate flows working by routing privileged operations through the **service role in the API server**. The unifying preservation principle is: service-role (API server) operations bypass RLS and **must remain byte-for-byte unchanged**; only `anon`/`authenticated` client paths and one misconfiguration guard change behavior.

Two findings are already partially mitigated in the live codebase and the design accounts for that:
- The authenticated profile endpoint (`GET`/`PATCH /api/profile`) **already exists** in `artifacts/api-server/src/routes/profile.ts` (`requireUser`, id from `req.authUser`, whitelists `full_name`/`default_address`). It is missing the mandated Zod `validate(schema)` middleware, and `LoginModal.tsx:134` still writes `users` directly. `useProfile.ts` already calls `/profile`.
- The admin coupons page already mutates via the admin API (`POST`/`PATCH`/`DELETE /admin/coupons`) but **reads the list via the anon client**, which is exactly what the public-read policy removal (SEC-003) would break — so a `GET /admin/coupons` is required.

## Glossary

- **Bug_Condition (C)**: The condition that triggers a defect — an `anon`/`authenticated` caller acting through RLS in a way the policy wrongly permits/denies, or a misconfigured environment/bundle. Formalized per finding in the Bug Condition Derivation appendix of `bugfix.md`.
- **Property (P)**: The desired post-fix behavior for inputs satisfying C (e.g. "role write is rejected", "anon coupon read returns no rows").
- **Preservation**: Existing behavior for `¬C` that must stay identical — above all, **service-role operations bypass RLS unchanged**, and legitimate client reads/writes are retained.
- **anon / authenticated**: Supabase client roles carried by `VITE_SUPABASE_ANON_KEY`. RLS applies.
- **service_role**: The API-server credential (`SUPABASE_SERVICE_ROLE_KEY`). RLS does **not** apply.
- **`getAdminSupabase()` / `getSupabase()`**: Typed `SupabaseClient<Database>` factories in `artifacts/api-server/src/lib/supabase.ts` (service-role and anon respectively).
- **`requireAdmin` (middleware) / `requireUser`**: Express **middleware** (`src/middlewares/`) attaching `req.admin`/`req.user` (403) and `req.authUser` (401). This is the canonical project pattern and the one the new `GET /admin/coupons` route uses (`req.admin!`). Admin authority derives **solely** from `users.role`.
- **`requireAdmin` (legacy resolver)**: A separate, older `requireAdmin(req): Promise<{ user, admin } | null>` function in `artifacts/api-server/src/lib/supabase.ts` that reads `users.role` and returns a resolved object (or `null`) rather than acting as middleware. This is the function the security report's **SEC-001 trust chain** cites. It is distinct from the Express middleware above; both read `users.role`, so both stay correct once clients can no longer write `role`. Disambiguated here so an implementer wires the correct one (routes use the middleware; SEC-001 trust-chain reasoning concerns the legacy resolver).
- **`validate(schema)`**: Zod body-validation middleware (`src/middlewares/validate.ts`) → `400 { error }`, attaches `req.validatedBody`.
- **`public.is_admin()`**: A new `security definer stable` SQL helper that resolves admin status without a policy on `users` querying `users` (breaks the recursion anti-pattern).
- **Control-plane DB**: The separate multi-tenant Supabase project (`supabase/control-plane/migrations/`), deny-by-default (RLS on, no policies), owned by the `super-admin-platform` feature.
- **Live schema**: The production database, which is **ahead of** the checked-in `supabase/schema.sql`; it is the source of truth for current policy text.

## Bug Details

### Bug Condition

The bug surface spans seven findings; each has a precise `isBugCondition(X)` in the `bugfix.md` appendix. The unifying form: a defect manifests when a client role (`anon`/`authenticated`) reaches a privileged operation through a too-permissive (or wrongly-shaped) RLS policy, or when an environment/bundle is misconfigured.

**Formal Specification (representative — SEC-001, the P0 root defect):**
```
FUNCTION isBugCondition(input)
  INPUT: input = { caller, table, operation, columns }
  OUTPUT: boolean

  RETURN input.caller = 'authenticated'        // anon-client JWT, not service role
     AND input.table = 'users'
     AND input.operation = 'UPDATE'
     AND 'role' IN input.columns
END FUNCTION
```

The remaining findings are characterized by:
- **SEC-002**: `caller ∈ {anon, authenticated} ∧ table = size_guides ∧ op ∈ {INSERT, UPDATE, DELETE}`
- **SEC-003**: `caller = anon ∧ table = coupons ∧ op = SELECT`
- **SEC-004**: `caller = authenticated ∧ table = comments ∧ op = INSERT ∧ row.approved = true`
- **SEC-005**: `table ∈ {users, audit_log, pages} ∧ policyUsesInlineUsersSubquery = true`
- **SEC-006**: `context = api-server-startup ∧ env.SUPABASE_SERVICE_ROLE_KEY = UNSET`
- **SEC-007**: `artifact = storefront-bundle ∧ containsControlPlaneCredential = true`

### Examples

- **SEC-001 (Critical, confirmed by static review):** A logged-in customer runs in the browser console `createClient().from("users").update({ role: "admin" }).eq("id", myId)`. Policy `"Users: own row" for all using (auth.uid() = id)` defaults `with check` to the same predicate with **no column restriction**, so the write succeeds. Afterwards `requireAdmin` reads `role = 'admin'` and grants full `/admin/*` access. **Expected:** the write is rejected and `requireAdmin` still returns 403.
- **SEC-002 (High, confirmed live):** Anon `POST /rest/v1/size_guides` passes RLS (`using(true) with check(true)`) and only fails on a FK check (`23503`/409). With a valid `category_id` the row persists. **Expected:** RLS rejects with `42501` (401/403).
- **SEC-003 (High, confirmed live):** Anon `GET /rest/v1/coupons` returns `WELCOME10`, `FLAT20`, `TEST_10PCT`, `TEST_5AZN` with discount values. **Expected:** anon `select` returns no rows; validation only via `POST /api/coupons/validate`.
- **SEC-004 (High):** Authenticated insert into `comments` with `approved = true` is accepted and published unmoderated. **Expected:** rejected; `approved = false` insert succeeds and stays hidden until admin approval.
- **SEC-005 (Medium→Low, did NOT reproduce live):** Policies on `users`/`audit_log`/`pages` subquery `users` from within a `users` policy — the Supabase infinite-recursion anti-pattern. Live `GET /rest/v1/users` returned `200 []` with no `42P17`, so this is treated as maintainability/fragility hardening, not a confirmed runtime fault.
- **SEC-006 (Medium):** API server boots with `SUPABASE_SERVICE_ROLE_KEY` unset → `serviceKey || anonKey` silently yields an anon "admin" client; admin ops then unpredictably hit RLS. **Expected:** fail fast on startup.
- **SEC-007 (Low/Informational):** The storefront bundle ships `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` (from `vercel.json`) and `lib/platform/client.ts` builds a browser control-plane client. Control-plane is deny-by-default today (anon `GET /stores` → `200 []`), so it is safe now but network-reachable from every browser. **Expected:** no control-plane credential in the bundle; access is API-server-only; deny-by-default asserted by test.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors (these MUST continue to work after the fix):**
- Service-role reads/writes on `users` (including `requireAdmin` reading `users.role`, the `/profile` endpoint update, `AdminLayout` unlocking for a genuine admin). [3.1]
- A legitimate customer updating their own `full_name` / `default_address` via the authenticated `/profile` endpoint. [3.1, 3.8]
- Admin `size_guides` writes via service role, and public `select` reads of `size_guides` (read policy retained). [3.2]
- `POST /api/coupons/validate` validating a known code (e.g. `WELCOME10`) and `lib/coupon-calc.ts calculateDiscount()` behaving identically. [3.3]
- Authenticated `comments` insert with `approved = false`, kept hidden until admin moderation via service role. [3.4]
- All non-recursive own-row policies (orders, cart, wishlist, profile reads) enforcing identical access decisions; admin service-role ops bypassing RLS unchanged. [3.5]
- `getAdminSupabase()` returning a service-role client that bypasses RLS when the key **is** set. [3.6]
- Normal storefront store-DB access with `VITE_SUPABASE_ANON_KEY`, and anon `select` on control-plane tables (e.g. `stores`) returning no rows (deny-by-default holds). [3.7]
- The admin coupons page still displaying the coupon list (now via `GET /admin/coupons`). [3.9]

**Scope:**
All inputs that do NOT satisfy a finding's bug condition must be completely unaffected. In particular **every service-role operation** (`getAdminSupabase()` in any route) is `¬C` for every finding and must produce identical results. The actual expected *correct* behavior for the buggy inputs is defined in the Correctness Properties section below.

## Hypothesized Root Cause

1. **Missing column-level write restriction on `users` (SEC-001).** `for all using (auth.uid() = id)` lets the owner write **any** column, including `role`; the `role` check constraint explicitly permits `'admin'`. Root cause is that authorization granularity (column) is absent and there is no DB-level immutability guard. Profile writes share this same client-write path, so closing it requires a server-side replacement (SEC-008).

2. **`using(true) with check(true)` on `size_guides` (SEC-002).** A comment assumed "service role only", but `true/true` grants `anon`/`authenticated` full write. Root cause: relying on a policy where the correct answer is *no client policy at all* (service role bypasses RLS).

3. **Public-read scope too broad on `coupons` (SEC-003).** `using (is_active = true)` exposes sensitive marketing data to anon. Root cause: a read that should be server-only was modeled as a public RLS read; the admin UI then leaned on that same policy for its list.

4. **Insert policy omits the moderation column (SEC-004).** `with check (auth.uid() = user_id)` validates ownership but not `approved`. Root cause: the moderation invariant (`approved = false` on self-insert) was never encoded in the policy.

5. **Policy-on-`users` queries `users` (SEC-005).** Inline `exists (select 1 from public.users …)` duplicated per table is the recursion anti-pattern and is fragile. Root cause: no shared, recursion-safe admin predicate.

6. **Permissive env fallback (SEC-006).** `serviceKey || anonKey` trades a loud failure for silent degradation. Root cause: defensive defaulting where fail-fast is correct.

7. **Control-plane credential in the browser bundle (SEC-007).** A `VITE_`-prefixed control-plane key is bundled and an active browser client is constructed. Root cause: control-plane access was placed in the storefront rather than behind the API server; mitigated only by deny-by-default RLS.

## Correctness Properties

Property 1: Bug Condition — Role is immutable from the client (SEC-001, three mandatory defenses)

_For any_ input where the bug condition holds (`caller = authenticated ∧ table = users ∧ op = UPDATE ∧ 'role' ∈ columns`), the fixed system SHALL reject the write, AND `requireAdmin` SHALL continue to return 403 for that caller. The fix SHALL apply ALL THREE defenses together: (a) `users` is `select`-only for clients, (b) `update` is granted to `authenticated` only on `full_name`/`default_address` (never `role`/`email`/`phone`), (c) a `before update` trigger rejects any `role` change unless the caller is the service role.

**Validates: Requirements 2.1, 2.8, 3.1, 3.8**

Property 2: Bug Condition — `size_guides` not client-writable (SEC-002)

_For any_ input where `caller ∈ {anon, authenticated} ∧ table = size_guides ∧ op ∈ {INSERT, UPDATE, DELETE}`, the fixed system SHALL reject the write with an RLS error (`42501` / HTTP 401/403), while public `select` and service-role writes remain unchanged.

**Validates: Requirements 2.2, 3.2**

Property 3: Bug Condition — `coupons` not anon-readable (SEC-003)

_For any_ input where `caller = anon ∧ table = coupons ∧ op = SELECT`, the fixed system SHALL return no rows; coupon validation SHALL occur only via `POST /api/coupons/validate` (service role), and the admin list SHALL be served via `GET /admin/coupons` (service role, `requireAdmin`) with no public coupon-read view introduced.

**Validates: Requirements 2.3, 2.9, 3.3, 3.9**

Property 4: Bug Condition — Comment moderation enforced on insert (SEC-004)

_For any_ input where `caller = authenticated ∧ table = comments ∧ op = INSERT ∧ row.approved = true`, the fixed system SHALL reject it; inserts with `approved = false` SHALL succeed and remain hidden until admin approval.

**Validates: Requirements 2.4, 3.4**

Property 5: Bug Condition — Recursion-safe admin policies (SEC-005)

_For any_ policy on `users`/`audit_log`/`pages` where the bug condition holds (inline `users` subquery), the fixed policy SHALL use `public.is_admin()`, no policy on `users` SHALL query `users`, a direct authenticated `select` on `users`/`audit_log` SHALL NOT raise a recursion error, and admin/non-admin access decisions SHALL be preserved.

**Validates: Requirements 2.5, 3.5**

Property 6: Bug Condition — Fail fast on missing service key (SEC-006)

_For any_ startup where `SUPABASE_SERVICE_ROLE_KEY` is unset, `getAdminSupabase()` SHALL throw/exit rather than return an anon "admin" client; when the key is set it SHALL return a service-role client exactly as today.

**Validates: Requirements 2.6, 3.6**

Property 7: Bug Condition — No control-plane credential in the browser (SEC-007)

_For any_ storefront bundle, the fixed artifact SHALL NOT contain control-plane credentials, control-plane access SHALL be API-server-only (service role) OR any residual browser usage SHALL be explicitly documented and justified, and control-plane tables SHALL be asserted deny-by-default. Normal storefront store-DB anon access SHALL be unchanged.

**Validates: Requirements 2.7, 3.7**

Property 8: Preservation — Non-buggy inputs and the migration-delivery rule (cross-cutting)

_For any_ input where no finding's bug condition holds, the fixed system SHALL produce the same result as the original (service-role ops, own-row policies, public reads, coupon math). Every change SHALL ship as a migration under `supabase/migrations/` reflected in `supabase/schema.sql`, reconciled against the LIVE schema before and after.

**Validates: Requirements 2.10, 3.5**

## Fix Implementation

Assuming the root-cause analysis is correct. All SQL ships as migrations (see Migration Plan) and is mirrored into `supabase/schema.sql`.

### Migration Plan (ordered, P0 → P1 → P2)

Each migration is independent and idempotent where possible (`drop policy if exists` / `create or replace`). Apply in this order; each is reconciled against the live schema immediately before and after (2.10).

| # | File (`supabase/migrations/`) | Finding | Priority |
|---|-------------------------------|---------|----------|
| 1 | `20240101_sec001_users_role_immutability.sql` | SEC-001 (a)(b)(c) | P0 |
| 2 | `20240102_sec002_drop_size_guides_world_write.sql` | SEC-002 | P1 |
| 3 | `20240103_sec003_drop_coupons_public_read.sql` | SEC-003 | P1 |
| 4 | `20240104_sec004_comments_insert_unapproved_only.sql` | SEC-004 | P1 |
| 5 | `20240105_sec005_is_admin_helper_and_policies.sql` | SEC-005 | P2 |
| C | `supabase/control-plane/migrations/009_assert_deny_by_default.sql` | SEC-007 (assertion) | P2 |

> Migration filenames use the project's existing descriptive convention (the `supabase/migrations/` folder uses names like `create_size_guides.sql`); the date prefixes encode ordering. Adjust prefixes to the actual apply date at implementation time. SEC-006 and the client/bundle parts of SEC-007 are code/config changes, not SQL migrations.

### SEC-001 — `users.role` immutability (P0, all three defenses)

**Migration `20240101_sec001_users_role_immutability.sql`:**
```sql
-- (a) Make public.users read-only for clients. Drop the for-all own-row policy
--     and replace with a SELECT-only own-row policy. Client writes move to the
--     authenticated /api/profile endpoint (service role).
drop policy if exists "Users: own row" on public.users;
create policy "Users: own row read"
  on public.users for select
  using (auth.uid() = id);

-- (b) Column-level privileges: role is never client-writable. Revoke the broad
--     UPDATE, then grant UPDATE only on the two profile columns. NOT role,
--     email, or phone (email/phone are out of scope and not client-writable).
revoke update on public.users from authenticated;
grant update (full_name, default_address) on public.users to authenticated;

-- (c) Defense-in-depth trigger: reject ANY role change unless the caller is the
--     service role, so escalation is blocked even if a policy regresses later.
create or replace function public.enforce_role_immutability()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.role is distinct from old.role then
    -- Allow the change only for service-role / privileged DB roles. Detection
    -- (primary → secondary):
    --   * PRIMARY: the JWT 'role' claim read from request.jwt.claims, i.e.
    --     current_setting('request.jwt.claims', true)::json ->> 'role'
    --     (equivalently auth.jwt() ->> 'role'). PostgREST sets it to
    --     'service_role' for the service key, 'authenticated'/'anon' otherwise.
    --     This replaces the deprecated auth.role() helper.
    --   * SECONDARY: current_user → the connected Postgres role; service-role
    --     connections run as 'service_role'. Migrations run as
    --     'postgres'/'supabase_admin'.
    if coalesce(
         current_setting('request.jwt.claims', true)::json ->> 'role',
         ''
       ) = 'service_role'
       or current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;
    raise exception 'role is immutable from the client'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_role_immutable on public.users;
create trigger trg_users_role_immutable
  before update on public.users
  for each row
  execute function public.enforce_role_immutability();
```

**RLS enforcement order — why (a) alone already blocks all client writes:** Under the new SELECT-only `"Users: own row read"` policy there is **no** `INSERT`/`UPDATE`/`DELETE` policy on `public.users` for client roles. RLS evaluates the **policy** before column privileges: with no UPDATE policy present, RLS denies **every** client UPDATE to `public.users` outright — regardless of any column-level `GRANT` — because the row-level write is blocked before column privileges are ever evaluated. Consequently, after this fix **anon/authenticated clients cannot write `public.users` at all**; all profile writes go through the service-role `/profile` endpoint (SEC-008/2.8). This means defense **(b)** `grant update (full_name, default_address)` is **dormant / future-proofing**: it has no effect while the SELECT-only policy stands, and only becomes active if a future UPDATE policy is reintroduced on `public.users`. All three defenses are nonetheless kept in the migration as **defense-in-depth** — but an implementer must not read (b) as evidence that clients can still self-service profile edits via the anon client. They cannot; the policy layer denies the write first.

**How service-role context is detected in Supabase:** PostgREST attaches the JWT to the session as the `request.jwt.claims` GUC. The **primary** detection reads the `role` claim directly — `current_setting('request.jwt.claims', true)::json ->> 'role'` (equivalently `auth.jwt() ->> 'role'`) — which is `'service_role'` for the service key and `'authenticated'`/`'anon'` for the anon key. This replaces the deprecated `auth.role()` helper. The **secondary** signal is `current_user`: the service-role connection is established as the Postgres role `service_role`, so `current_user` reflects it; we also accept `postgres`/`supabase_admin` so SQL migrations and the dashboard can still set roles. We accept **either** signal. The trigger is `security invoker` so `current_user` is the real caller (not the function owner). Because the API server uses the service role for the `/profile` update and for any admin role assignment, **Preservation [3.1] holds**: service-role writes pass the trigger unchanged.

**Pre-flight verify-against-live (mandatory before applying the P0 migration):** Supabase environments differ in which claim helpers are populated, so before applying `20240101_sec001_users_role_immutability.sql` to the LIVE database, confirm on that live DB which of `auth.role()` / `auth.jwt()` / `request.jwt.claims` is actually available, and that the chosen expression `current_setting('request.jwt.claims', true)::json ->> 'role'` correctly returns `'service_role'` for a service-key connection and `'authenticated'`/`'anon'` for a client connection. Verify with a probe such as `select current_setting('request.jwt.claims', true)::json ->> 'role'` executed under each key. Only proceed with the trigger once the live behavior is confirmed; if the live DB exposes the claim differently, adjust the expression to the verified form before applying.

**Trust chain note:** The legacy resolver `requireAdmin(req): Promise<{ user, admin } | null>` in `lib/supabase.ts` (the one the SEC-001 trust chain cites — distinct from the Express `requireAdmin` middleware in `src/middlewares/` used by routes) still reads `users.role` via the service role and trusts it. Since clients can no longer write `role` (policy + grant + trigger), the trust chain remains intact and a non-admin still resolves to unauthorized. The new `GET /admin/coupons` route uses the **middleware** (`req.admin!`), not the legacy resolver; both read `users.role` and both stay correct after this fix.

**Schema reflection:** Replace `supabase/schema.sql:34` (`"Users: own row" for all`) with the SELECT-only policy, append the `revoke`/`grant`, the function, and the trigger in the `users` block.

### SEC-008 / 2.8 — Authenticated profile-write endpoint (replacement path)

The endpoint **already exists** (`routes/profile.ts`, `GET`/`PATCH /profile`, `requireUser`, id from `req.authUser`, whitelists `full_name`/`default_address`, writes via `getAdminSupabase()`). Two gaps remain to satisfy 2.8 fully:

1. **Add the mandated Zod `validate(schema)` middleware.** Define a co-located schema (mirroring `routes/admin/schemas.ts` style) and wire it into the existing `PATCH` route. The schema whitelists exactly the two profile fields; unknown keys (`role`, `email`, `phone`) are stripped by Zod's default object behavior, never accepted.

**New schema (e.g. `routes/schemas.ts` or inline in `profile.ts`):**
```ts
import { z } from "zod";

// Profile self-update: whitelist of client-writable columns ONLY.
// role/email/phone are intentionally absent → stripped, never written.
export const UpdateProfileSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).nullable().optional(),
    default_address: z.string().trim().max(500).nullable().optional(),
  })
  .strict() // reject unexpected keys with 400 rather than silently passing
  .refine(
    (b) => b.full_name !== undefined || b.default_address !== undefined,
    { message: "Nothing to update" },
  );
```

**Updated route handlers (`routes/profile.ts`) — bring BOTH GET and PATCH to Express 5 convention.** The existing GET and PATCH handlers currently use the `return res.json(...)` / `return res.status(400).json(...)` form and are **not** annotated `Promise<void>`, which violates the project's Express 5 early-return steering rule ("Never: `return res.status().json()`"). Since PATCH is being modified for SEC-008, this design SHALL also correct GET: both handlers use `res.status(...).json(...); return;` early-returns, are `async` annotated `Promise<void>`, and contain no `try/catch`-for-500 (the central `errorHandler` auto-forwards).

```ts
import { validate } from "../middlewares/validate";
import { UpdateProfileSchema } from "./schemas";

// GET /profile — corrected to Express 5 convention (was: `return res.json(profile ?? {...})`)
router.get("/profile", requireUser, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;
  const admin = getAdminSupabase();
  const { data: profile, error } = await admin
    .from("users")
    .select("full_name, phone, default_address")
    .eq("id", userId)
    .single();
  if (error) throw error;                                // central errorHandler → generic 500
  res.json(profile ?? { full_name: null, phone: null, default_address: null });
  return;                                                // early-return form, not `return res.json(...)`
});

// PATCH /profile — SEC-008 fix: Zod validate + service-role write, id from token
router.patch("/profile", requireUser, validate(UpdateProfileSchema), async (req, res): Promise<void> => {
  const userId = req.authUser!.id;                       // target id from token, never body
  const body = req.validatedBody as { full_name?: string | null; default_address?: string | null };

  const updates: { full_name?: string | null; default_address?: string | null } = {};
  if (body.full_name !== undefined) updates.full_name = body.full_name ?? null;
  if (body.default_address !== undefined) updates.default_address = body.default_address ?? null;

  const admin = getAdminSupabase();                      // service role bypasses RLS + trigger
  const { data: profile, error } = await admin
    .from("users")
    .update(updates)
    .eq("id", userId)
    .select("full_name, phone, default_address")
    .single();
  if (error) throw error;                                // central errorHandler → generic 500
  res.json(profile);
  return;                                                // early-return form
});
```
Note: no `try/catch` for 500s (Express 5 auto-forwards); explicit `400` is now produced by `validate`. `.strict()` is chosen so a stray `role` key yields a loud `400` instead of a silent strip — defense in depth at the API edge mirroring the DB layer.

**`.strict()` client-compatibility (verified):** `.strict()` on `UpdateProfileSchema` is **safe for all existing callers** — this is a verified compatibility check, not an open risk. `useProfile.ts updateProfile` is typed `Partial<Pick<UserProfile, 'full_name' | 'default_address'>>` and only ever sends those two keys, and `LoginModal` sends only `{ full_name }`. No current client sends any key outside the schema's whitelist, so no existing caller will trip the strict-reject. Keep `.strict()`.

2. **Re-route the remaining direct client write in `LoginModal.tsx:134`.** Replace the anon-client `users` update with a call to the endpoint using the existing authed fetch helper.

**`LoginModal.tsx` `handleNameSubmit` change:**
```ts
// BEFORE
const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();
if (user) {
  await supabase.from("users").update({ full_name: fullName.trim() }).eq("id", user.id);
}

// AFTER
import { userFetch } from "@/lib/user-fetch";
// ...
await userFetch(apiUrl("/profile"), {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ full_name: fullName.trim() }),
});
```
`useProfile.ts updateProfile` already PATCHes `/profile` via `userFetch` — no change required, just confirmation it no longer depends on the dropped client-write policy.

### SEC-002 — Drop `size_guides` world-write (P1)

**Migration `20240102_sec002_drop_size_guides_world_write.sql`:**
```sql
-- Drop the world-write policy. Admin writes flow through the service role
-- (bypasses RLS, needs no policy). Retain the public read policy.
drop policy if exists "size_guides_admin_write" on public.size_guides;
-- retained: "size_guides_read" ... for select using (true);
```
**Schema reflection:** Remove the `size_guides_admin_write` policy from the canonical `create_size_guides.sql` definition mirrored into `schema.sql`; keep `size_guides_read`. Admin size-guide writes already go through `routes/size-guides.ts` (service role) — unchanged [3.2].

### SEC-003 — Remove public coupon read + admin list endpoint (P1)

**Migration `20240103_sec003_drop_coupons_public_read.sql`:**
```sql
-- Remove broad public read. Validation is server-side only (service role).
-- No public coupon-read view is introduced.
drop policy if exists "Coupons: public read active" on public.coupons;
-- retained: "Coupons: admin all" (rewritten to is_admin() in SEC-005 if desired)
```

**New `GET /admin/coupons` (in `routes/admin/coupons.ts`, registered before any `/:id`):**
```ts
router.get("/admin/coupons", requireAdmin, async (req, res): Promise<void> => {
  const admin = req.admin!;
  const { data, error } = await admin
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  res.json(data ?? []);
});
```
This literal route must be added; the existing file already registers `POST /admin/coupons` and `:id` routes, so the `GET` literal is safe alongside them (no `/:id` collision on the bare path).

**`CouponsPage.tsx` data-fetch change** (replace the anon-client read):
```ts
// BEFORE
const supabase = createClient();
(supabase as any).from("coupons").select("*").order("created_at", { ascending: false })
  .then(({ data }: any) => setCoupons(data ?? []));

// AFTER
import { adminFetch } from "@/lib/admin-fetch";
adminFetch(apiUrl("/admin/coupons"))
  .then((r) => r.json())
  .then((data) => setCoupons(data ?? []));
```
The `createClient` import is removed if no longer used elsewhere in the file. Mutations already use `adminFetch` — unchanged. `POST /api/coupons/validate` is untouched [3.3].

### SEC-004 — Constrain comment insert to `approved = false` (P1)

**Migration `20240104_sec004_comments_insert_unapproved_only.sql`:**
```sql
drop policy if exists "Comments: own insert" on public.comments;
create policy "Comments: own insert"
  on public.comments for insert
  with check (auth.uid() = user_id and approved = false);
-- retained: "Comments: public read approved" (select using approved = true)
--           "Comments: admin all"
```
**Schema reflection:** Replace `schema.sql:344`. Admin moderation via service role is unchanged [3.4]; `approved = false` inserts still succeed and stay hidden until approval.

### SEC-005 — `is_admin()` helper + recursion-safe policies (P2, downgraded)

> **Live caveat:** SEC-005 **did not reproduce** live (`GET /rest/v1/users` → `200 []`, no `42P17`). This is maintainability/fragility hardening, not a confirmed runtime fault. Scope per AC 2.5 is the three tables `users`, `audit_log`, `pages`.

**Migration `20240105_sec005_is_admin_helper_and_policies.sql`:**
```sql
-- security definer + stable: resolves admin status WITHOUT a policy on users
-- querying users (the helper runs as owner, bypassing RLS on its own select).
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- users: replace inline subquery admin policy
drop policy if exists "Admins: all users" on public.users;
create policy "Admins: all users" on public.users for all using (public.is_admin());

-- audit_log: replace inline subquery admin read policy
drop policy if exists "AuditLog: admin read" on public.audit_log;
create policy "AuditLog: admin read" on public.audit_log for select using (public.is_admin());

-- pages: replace inline subquery admin policy (defined in create_pages.sql)
drop policy if exists "Pages: admin write" on public.pages;             -- exact name reconciled against live
create policy "Pages: admin write" on public.pages for all using (public.is_admin());
```
**Reconciliation note:** the `pages` policy name must be confirmed against the **live** schema before drop (the checked-in `create_pages.sql` may differ). Admin/non-admin decisions are preserved [3.5].

**DESIGN DECISION — scope of the recursion-safe rewrite (explicit, not an oversight):** AC 2.5 scopes this fix to `users`, `audit_log`, and `pages` only. The inline `exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')` anti-pattern appears in **~13 policies** across `schema.sql`. Of these, exactly one is **truly recursive** — a policy **ON `users` that queries `users`** — namely **"Admins: all users"**; it IS in scope and is rewritten to `public.is_admin()` by the migration above. The remaining **~10 admin policies subquery `users` from a *different* table**, so they are **fragile-but-not-recursive** and are **INTENTIONALLY left unchanged in this spec** (out of AC 2.5 scope). They are recorded here as an **optional consistency follow-up** so reviewers can see the full inventory — they are not missed and must not be silently dropped:

1. `Categories: admin write` (ON `categories`)
2. `CatTrans: admin write` (ON `category_translations`)
3. `Products: admin write` (ON `products`)
4. `ProdTrans: admin write` (ON `product_translations`)
5. `ProdImages: admin write` (ON `product_images`)
6. `ProdCats: admin write` (ON `product_categories`)
7. `Coupons: admin all` (ON `coupons`)
8. `CouponUsages: admin` (ON `coupon_usages`)
9. `Orders: admin all` (ON `orders`)
10. `OrderItems: admin all` (ON `order_items`)
11. `Comments: admin all` (ON `comments`)

(Inventory totals ~13 with the three in-scope policies: `Admins: all users` ON `users`, the `audit_log` admin read, and the `pages` admin policy. The `AuditLog: admin read` policy is in scope and rewritten above.) These ~10 cross-table policies MAY be migrated to `is_admin()` later for consistency; that consistency pass is explicitly **not part of this fix**.

**Schema reflection:** add `public.is_admin()` near the top of `schema.sql` (after extensions, before policies) and rewrite the three policies.

### SEC-006 — Fail fast on missing service key (P2)

**`artifacts/api-server/src/lib/supabase.ts` change:**
```ts
export function getAdminSupabase(): SupabaseClient<Database> {
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return createClient<Database>(url, serviceKey, {   // no `serviceKey || anonKey` fallback
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```
**Where it's enforced:** `getAdminSupabase()` is called on every admin/service path (`requireAdmin`, `/profile`, `coupons`, etc.). To make it a true **startup** failure (2.6) rather than first-request, add an eager assertion in the server entry (`src/index.ts`) or env resolution: e.g. call `getAdminSupabase()` once during boot (or assert `serviceKey` in `resolveSupabaseEnv` for the api-server) so the process exits before listening. When the key is set, behavior is identical [3.6].

### SEC-007 — Control-plane browser usage reconciliation (P2)

**Chosen resolution:** **Route control-plane access through the API server (service role); remove control-plane credentials from the browser bundle.** This aligns with the threat model (control-plane is API-server-only) and removes the network-reachability concern entirely.

Concretely:
- **Remove `VITE_CONTROL_PLANE_SUPABASE_URL` / `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` from `vercel.json`** (storefront build) so they are not bundled.
- **Reconcile `artifacts/store/src/lib/platform/client.ts`.** This file belongs to the separate `super-admin-platform` feature, so the change is **coordinated with that spec** (explicit dependency). The `/platform/*` super-admin auth currently uses this browser client. The resolution is to move `/platform/*` data/auth flows behind API-server endpoints backed by the control-plane service role (mirroring `getAdminSupabase()` for the control-plane project). Until `super-admin-platform` lands that routing, this design documents the dependency and does **not** unilaterally delete `client.ts`; the credential removal is the enforceable browser-side guarantee.
- **Deny-by-default assertion** added as a control-plane migration/test (`009_assert_deny_by_default.sql` + a vitest/SQL check) verifying RLS is enabled and **no policies** exist on control-plane tables (e.g. `stores`).

```sql
-- supabase/control-plane/migrations/009_assert_deny_by_default.sql
-- Fails the migration if any control-plane table has RLS disabled or any policy.
do $$
declare bad int;
begin
  select count(*) into bad
  from pg_tables t
  where t.schemaname = 'public'
    and not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
    );
  if bad > 0 then raise exception 'control-plane: % table(s) without RLS', bad; end if;

  select count(*) into bad from pg_policies where schemaname = 'public';
  if bad > 0 then raise exception 'control-plane: unexpected % policy(ies) present', bad; end if;
end $$;
```
Normal storefront store-DB anon access is unchanged [3.7].

### Error-handling alignment

All new/changed API handlers follow the project conventions: no `try/catch` purely to emit a 500 (Express 5 auto-forwards to the central `errorHandler`, which logs and returns generic `{ error: "Internal server error" }`). Explicit non-500 returns (`400` via `validate`, `401` via `requireUser`, `403` via `requireAdmin`) stay inline and use the `res.status().json(); return;` early-return form (never `return res.status()`). Async handlers are annotated `Promise<void>`. No audit entries are added for the read-only `GET /admin/coupons`; existing coupon mutations already audit via their handlers.

## Testing Strategy

### Validation Approach

Two-phase: (1) surface counterexamples that demonstrate each defect on the **unfixed** code/policy to confirm the root cause; (2) verify the fix satisfies each Fix-Checking property and preserves `¬C` behavior. The project's 3-layer strategy maps as: **unit/property (vitest)** for pure functions and request-shaping logic that need no DB; **integration / RLS-level** checks (live or local Supabase with both anon and service-role keys) for anything where the *policy itself* is the assertion; **E2E (Playwright)** for the end-to-end profile and admin-coupons flows.

**Testability triage — what needs a live/RLS DB vs. what does not:**

| Finding | Unit/property (no DB) | Needs RLS-level / integration DB |
|---------|----------------------|----------------------------------|
| SEC-001 | Profile Zod schema strips/loud-rejects `role`; trigger SQL text present in migration | RLS+grant+trigger actually reject `update role` as `authenticated`; service-role update still works |
| SEC-008 | `UpdateProfileSchema` accept/reject cases; handler derives id from token not body; LoginModal calls `/profile` | `PATCH /profile` persists `full_name`/`default_address` (integration) |
| SEC-002 | Migration drops policy (structural) | anon INSERT/UPDATE/DELETE on `size_guides` → `42501`; service-role write ok; public read ok |
| SEC-003 | `GET /admin/coupons` handler shape; CouponsPage uses `adminFetch` not anon client | anon `select coupons` → 0 rows; `/coupons/validate` still validates |
| SEC-004 | Migration check expression (structural) | authenticated insert `approved=true` → rejected; `approved=false` → ok + hidden |
| SEC-005 | `is_admin()` definition + policy rewrites present | direct authenticated `select users/audit_log` no recursion error; admin/non-admin decisions preserved |
| SEC-006 | `getAdminSupabase()` throws when key unset; returns client when set (unit, mock env) | — |
| SEC-007 | bundle/`vercel.json` has no `VITE_CONTROL_PLANE_*`; deny-by-default assertion test | control-plane anon `select stores` → 0 rows (live) |

### Exploratory Bug Condition Checking

**Goal:** demonstrate each defect BEFORE fixing; confirm/refute root cause (re-hypothesize if refuted).

**Test Plan & Cases:**
1. **SEC-001:** As `authenticated`, `update users set role='admin'` → currently **succeeds** (will fail-to-reject on unfixed policy). Confirms missing column/trigger guard.
2. **SEC-002:** Anon `insert size_guides` with valid `category_id` → currently **persists** (live confirmed `23503` only on FK).
3. **SEC-003:** Anon `select coupons` → currently **returns active codes** (live confirmed).
4. **SEC-004:** Authenticated `insert comments {approved:true}` → currently **accepted**.
5. **SEC-005:** Direct authenticated `select users` → observe (live: `200 []`, **refutes** runtime recursion — documents downgrade).
6. **SEC-006:** Boot with key unset → currently **starts** with anon "admin" client.
7. **SEC-007:** Inspect built bundle → currently **contains** `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY`.

**Expected counterexamples:** writes/reads that should be denied are allowed (SEC-001/002/003/004); silent degradation (SEC-006); credential present in bundle (SEC-007).

### Fix Checking

**Goal:** for all inputs where a bug condition holds, the fixed system produces the expected behavior.
```
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT apply'(X) = REJECTED | EMPTY_RESULT | THROW   (per finding)
END FOR
// SEC-001 structural (all three present):
ASSERT usersWritePolicy'()   = 'SELECT only (auth.uid() = id)'
ASSERT clientUpdateGrant'()  = { full_name, default_address }
ASSERT roleChangeTrigger'()  = 'reject unless service role'
ASSERT requireAdmin(nonAdmin) = 403
```

**Concrete tests (mapped to properties):**
- **P1 / SEC-001:** *(unit/property, vitest)* `UpdateProfileSchema` rejects `{ role: "admin" }` (loud `400` via `.strict()`), accepts `{ full_name }`/`{ default_address }`, rejects empty object. *(RLS integration)* anon-key `update({role:'admin'})` → error (`42501`); service-role `update({role:'admin'})` → ok (trigger allows). *(unit)* assert migration text contains the SELECT-only policy, the `grant update (full_name, default_address)`, and the trigger (structural guard that all three defenses shipped).
- **P1 / SEC-008:** *(unit)* handler uses `req.authUser!.id` and ignores any `id` in body (call with mismatched body id, assert update targets token id — mock `getAdminSupabase`). *(unit)* `LoginModal` `handleNameSubmit` calls `userFetch('/profile', PATCH)` (render in jsdom, mock fetch, assert URL/method/body). *(integration)* `PATCH /profile` persists then `GET /profile` returns the new values.
- **P2 / SEC-002:** *(RLS integration)* anon INSERT/UPDATE/DELETE `size_guides` → `42501`; service-role insert ok; anon `select` ok.
- **P3 / SEC-003:** *(RLS integration)* anon `select coupons` → `[]`. *(unit)* `GET /admin/coupons` returns rows for admin, 403 for non-admin (mock `requireAdmin`). *(unit, jsdom)* `CouponsPage` issues `adminFetch('/admin/coupons')` and renders rows; no `createClient().from("coupons")` call. *(unit)* `POST /api/coupons/validate` unchanged (existing `coupon-calc` tests stay green).
- **P4 / SEC-004:** *(RLS integration)* authenticated insert `approved=true` → rejected; `approved=false` → ok and excluded from public `select` until admin approves (service role).
- **P5 / SEC-005:** *(RLS integration)* direct authenticated `select users`/`audit_log` → no `42P17`; `is_admin()` returns true for admin, false for non-admin; admin write decisions unchanged. *(unit)* migration defines `is_admin()` `security definer stable` and rewrites the three policies.
- **P6 / SEC-006:** *(unit, vitest)* with `SUPABASE_SERVICE_ROLE_KEY` unset, `getAdminSupabase()` throws `"SUPABASE_SERVICE_ROLE_KEY is required"`; with it set, returns a client (no anon fallback). *(unit)* boot assertion exits before `listen`.
- **P7 / SEC-007:** *(unit)* assert built bundle / `vercel.json` contains no `VITE_CONTROL_PLANE_*` key. *(SQL/integration)* `009_assert_deny_by_default.sql` passes (RLS on, zero policies); live control-plane anon `select stores` → `[]`.

### Preservation Checking

**Goal:** for all inputs where no bug condition holds, the fixed system equals the original.
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT apply(X) = apply'(X)         // service-role writes + legitimate client reads/writes unchanged
END FOR
ASSERT profileUpdate'(caller,{full_name,default_address}) = ACCEPTED   // own row, via /profile
ASSERT adminCouponList'() = readVia('admin API', requireAdmin, service_role)
ASSERT publicCouponView'() = NONE
```
**Testing approach:** property-based testing is preferred for preservation because it samples broadly across the input domain and catches edge cases. Observe behavior on **unfixed** code first, then encode it.

**Concrete tests (mapped to Property 8 / [3.1]–[3.9]):**
- *(property, vitest)* `UpdateProfileSchema` is identity-preserving for valid `{full_name?, default_address?}` payloads across generated strings (within length bounds) — accepted and normalized identically; never includes `role`/`email`/`phone`.
- *(integration)* service-role `update users` (role assignment, profile update) succeeds unchanged (trigger allows). [3.1]
- *(integration)* admin `size_guides` write via API still succeeds; public read still returns rows. [3.2]
- *(unit/property)* `calculateDiscount()` outputs unchanged across generated subtotals/coupons; `POST /coupons/validate` returns the same shape for `WELCOME10`. [3.3]
- *(integration)* `comments` `approved=false` insert → accepted, hidden; admin approval via service role works. [3.4]
- *(integration)* own-row policies (orders/cart/wishlist) yield identical access decisions; service-role ops bypass RLS unchanged. [3.5]
- *(unit)* `getAdminSupabase()` with key set returns a service-role client identical to today. [3.6]
- *(integration)* storefront anon store-DB reads unchanged; control-plane anon `select stores` → `[]`. [3.7]
- *(jsdom/E2E)* profile edit in `LoginModal`/`useProfile` persists via `/profile`. [3.8]
- *(jsdom/E2E)* admin coupons page renders the list via `GET /admin/coupons` exactly as before. [3.9]

### Unit Tests (vitest, no DB)

- `UpdateProfileSchema` accept/reject/identity property tests (`artifacts/api-server` test dir).
- `getAdminSupabase()` throw-when-unset / client-when-set (mock env).
- `GET /admin/coupons` handler: admin → rows, non-admin → 403 (mock middleware + `getAdminSupabase`).
- `LoginModal` / `CouponsPage` DOM tests (jsdom): assert they call `userFetch`/`adminFetch` and **no** direct Supabase client read/write (behavioral, not regex on source — per project test-quality rule).
- Structural migration assertions: SEC-001 three-defense presence, SEC-004 check expression, SEC-005 `is_admin()` + policy rewrites, SEC-007 bundle/`vercel.json` credential absence.

### Property-Based Tests

- Profile payload identity/whitelist property (generated valid/invalid bodies; `role`/`email`/`phone` always stripped or rejected).
- Coupon-calc preservation across generated subtotals/coupon configs (reuse existing generators).

### Integration Tests (RLS-level — local or live Supabase with anon + service-role keys)

- SEC-001/002/003/004/005 RLS assertions above (the policy *is* the assertion, so these cannot be unit-tested without a DB). Run in the CI `integration-e2e` job (Supabase available), gated by the Section 8 regression checklist.
- Control-plane deny-by-default assertion (`009_*.sql`) + live `select stores` → `[]`.

### Live-schema reconciliation (2.10)

Before applying each migration, dump the **live** policy/grant/trigger state for the target objects (live DB is ahead of `schema.sql`) and confirm the `drop ... if exists` targets the real current name (notably the `pages` and `users` policy names). After applying, re-dump and diff to confirm the intended end-state, then mirror the final definitions into `supabase/schema.sql` and regenerate `@workspace/supabase-types` if column-level types changed. Migrations are sequenced P0 → P1 → P2 exactly as in the Migration Plan table.
