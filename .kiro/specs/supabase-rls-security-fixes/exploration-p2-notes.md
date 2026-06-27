# P2 Exploration Notes — SEC-005 / SEC-006 / SEC-007 (task 17)

**Task:** tasks.md Task 17 (P2 exploration — observe conditions on UNFIXED code).
**Properties:** 5 (recursion-safe admin policies), 6 (fail-fast on missing service key), 7 (no control-plane credential in the browser).
**Requirements:** 1.5, 1.6, 1.7, 2.5, 2.6, 2.7.
**Test file:** `artifacts/api-server/tests/sec005-007-p2.exploration.test.ts`.
**Date:** live probes via Supabase MCP (service-role/management connection) + static file inspection. **No fix code written.**

---

## SEC-005 — recursion REFUTED → maintainability hardening (Property 5)

### Refutation confirmed live (no `42P17`)

A direct select on `users` / `audit_log` evaluated **under the `authenticated` role** (so RLS is actually applied — service role bypasses it) returned rows with **no infinite-recursion error**:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}';
select
  (select count(*) from public.users)    as users_visible_rows,     -- 0
  (select count(*) from public.audit_log) as audit_log_visible_rows; -- 0
rollback;
```

Result: `users_visible_rows = 0`, `audit_log_visible_rows = 0`, **no `42P17`**. This matches the design's recorded observation (`GET /rest/v1/users` → `200 []`). The hypothesised runtime recursion does **not** reproduce → SEC-005 is recorded as **maintainability / fragility hardening**, NOT a runtime-fault fix. The exploration test asserts "no `42P17`" as an INVARIANT (true on unfixed AND fixed code), and is explicitly labelled a refutation rather than a defect capture.

### Inline-`users`-subquery policies found live (the rewrite targets for task 18)

From `pg_policies` (schema `public`):

| Table | Policy | cmd | Predicate (USING) | Inline `users` subquery? |
|-------|--------|-----|-------------------|--------------------------|
| `audit_log` | `audit_admin_read` | SELECT | `EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')` | ✅ yes |
| `pages` | `Pages: admin all` | ALL | `EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')` | ✅ yes |
| `pages` | `Pages: public read published` | SELECT | `published = true` | no |
| `users` | `users_own_read` | SELECT | `auth.uid() = id` | no |
| `users` | `users_own_update` | UPDATE | `auth.uid() = id` | no |

### NUANCE vs design (important — does NOT change the P2 outcome)

- The design's SEC-005 text anticipated a **recursive policy named `"Admins: all users"` ON `public.users`** that subqueries `users`. **That policy does not exist on the live DB.** Live `public.users` carries only the two own-row policies above (`users_own_read`, `users_own_update`), neither of which self-references `users`.
- Because the `users` table's own policies are non-recursive, the `audit_log` / `pages` admin policies that subquery `users` resolve safely → this is the structural reason `42P17` never fires.
- Consequence for task 18: the in-scope rewrite targets confirmed live are **`audit_admin_read` (audit_log)** and **`Pages: admin all` (pages)**. The third design-named target on `users` itself is **not present live**, so task 18's live-schema reconciliation (18.1) should reconcile against these actual names rather than the design's assumed `"Admins: all users"`.
- This is a documentation nuance, not an "unexpected STOP" condition: the task's stated expectation (no `42P17` live) is met. The STOP condition would have been SEC-005 *raising* `42P17` live — it does not.

---

## SEC-006 — `getAdminSupabase()` silent anon fallback (Property 6) — counterexample captured

`artifacts/api-server/src/lib/supabase.ts`:

```ts
export function getAdminSupabase(): SupabaseClient<Database> {
  return createClient<Database>(url, serviceKey || anonKey, {   // ← silent fallback
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

The `serviceKey || anonKey` fallback means that when `SUPABASE_SERVICE_ROLE_KEY` is unset, `getAdminSupabase()` **silently returns an anon-key client** (a real, usable client that is subject to RLS) instead of failing fast. Env is resolved once at module-load via `resolveSupabaseEnv(process.env)` (`lib/env.ts`), so the exploration test simulates the unset key by deleting `SUPABASE_SERVICE_ROLE_KEY`, calling `vi.resetModules()`, and re-importing the module.

**Counterexample:** with the service key unset, `getAdminSupabase()` returns a truthy client (no throw). The fix (task 19) makes it `throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")`.

---

## SEC-007 — control-plane credential bundled into the browser (Property 7) — counterexample captured

`vercel.json` `build.env` (storefront build):

```json
"VITE_CONTROL_PLANE_SUPABASE_URL": "https://bffnmbsjahgmvhaqyugz.supabase.co",
"VITE_CONTROL_PLANE_SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…role:anon…"
```

Both control-plane vars are `VITE_`-prefixed, so Vite inlines them into the storefront bundle shipped to every browser. `artifacts/store/src/lib/platform/client.ts` constructs a browser control-plane client (`getControlPlaneClient()`) from exactly these two vars, confirming the credential is actively wired into client code (not dead config).

**Counterexample:** `vercel.json` build env contains `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` (a real `role:"anon"` JWT) today. The fix (task 20.1) removes both `VITE_CONTROL_PLANE_*` keys; task 20.2 asserts control-plane deny-by-default; task 20.3 coordinates the `client.ts` reconciliation with the `super-admin-platform` spec (do not unilaterally delete `client.ts`).

---

## Summary

| Finding | Condition on unfixed code | Captured as |
|---------|---------------------------|-------------|
| SEC-005 | direct authenticated `select users`/`audit_log` → `200 []`, **no `42P17`** | REFUTATION (invariant) → maintainability hardening; rewrite targets `audit_admin_read`, `Pages: admin all` |
| SEC-006 | `getAdminSupabase()` returns an anon-key client when service key unset | counterexample (silent degradation) |
| SEC-007 | `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY` present in `vercel.json` build env | counterexample (credential bundled to browser) |

No fix code was implemented for any finding (exploration only).
