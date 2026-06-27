# Pre-flight SEC-001 — Live-DB verification of the trigger claim expression

**Task:** tasks.md Task 1 (P0 checkable gate). MUST pass before applying the SEC-001 P0 migration (task 4).
**Requirements:** 2.1, 2.10
**Status:** ✅ PASS — claim mechanism confirmed, with one mandatory hardening adjustment for task 4 (see "Verified expression").
**Date:** live probe via Supabase MCP (service-role/management connection).

---

## 1. Probe results

### 1a. Baseline — the connection the Supabase MCP actually uses

```sql
select
  current_setting('request.jwt.claims', true)::json ->> 'role' as claim_role,
  current_setting('request.jwt.claims', true)                  as raw_claims,
  current_user, session_user,
  auth.role()              as auth_role,
  auth.jwt() ->> 'role'    as auth_jwt_role;
```

| claim_role | raw_claims | current_user | session_user | auth.role() | auth.jwt()->>'role' |
|------------|-----------|--------------|--------------|-------------|---------------------|
| `null`     | `null`    | `postgres`   | `postgres`   | `null`      | `null`              |

Interpretation:
- The MCP/management connection runs as **`postgres`**, NOT `service_role`, and carries **no** `request.jwt.claims` GUC (it is a direct admin/migration-style connection, not a PostgREST request).
- Both `auth.role()` and `auth.jwt()` helper functions **exist** on the live DB (they return `null` rather than erroring).
- This directly confirms the trigger's **SECONDARY signal**: `current_user = 'postgres'`, which is already in the design's accepted list `('service_role','postgres','supabase_admin')`. Migrations/dashboard role changes will pass the trigger.

### 1b. PRIMARY signal — claim resolution per connection type

The MCP cannot open a real anon-key / service-key PostgREST HTTP connection (see Limitations). PostgREST injects the JWT by setting the `request.jwt.claims` GUC, so the resolution was verified by setting that exact GUC with `set_config('request.jwt.claims', …, true)` — the same mechanism PostgREST uses:

| Simulated connection | GUC value set | `current_setting('request.jwt.claims',true)::json ->> 'role'` | trigger allows (`= 'service_role'`) |
|----------------------|---------------|---------------------------------------------------------------|-------------------------------------|
| service-key          | `{"role":"service_role",…}` | `service_role` | ✅ true |
| anon-key             | `{"role":"anon"}`           | `anon`         | ❌ false |
| authenticated        | `{"role":"authenticated",…}`| `authenticated`| ❌ false |

Result: the chosen expression returns `'service_role'` under a service-key connection and `'authenticated'`/`'anon'` under client connections — **exactly as the design assumes.** The PRIMARY detection signal is confirmed.

### 1c. Edge-case probe — empty-string vs absent claims GUC (robustness)

| Scenario | GUC state | Raw expr `...::json ->> 'role'` | `nullif(...,'')::json ->> 'role'` | `auth.jwt() ->> 'role'` |
|----------|-----------|----------------------------------|-----------------------------------|--------------------------|
| absent / NULL (migration, direct psql) | `current_setting` returns `NULL` | `NULL` (safe) | `NULL` (safe) | `NULL` (safe) |
| **empty string `''`** (len 0, not null) | `current_setting` returns `''` | **❌ ERROR `22P02` invalid input syntax for type json** | `NULL` (safe) | `NULL` (safe) |

This is the key finding of the pre-flight. The design's **raw** expression `current_setting('request.jwt.claims', true)::json` raises `22P02: invalid input syntax for type json` when the GUC is present but **empty** (`''`), because `''::json` is invalid. The absent/NULL case is fine, but an empty-string GUC would make the `BEFORE UPDATE` trigger **throw mid-evaluation** instead of cleanly falling through to the secondary `current_user` signal — risking a confusing failure on an otherwise-legitimate update.

Verified safe alternatives (no error in any of the 5 scenarios — service_role / anon / authenticated / empty / null):
- `nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'`
- `auth.jwt() ->> 'role'` — Supabase's `auth.jwt()` is internally defined with `nullif(...,'')`, so it is inherently empty-string-safe; confirmed live (returns `null` on `''`, `service_role` on a populated claim).

---

## 2. Verified expression to use in the SEC-001 trigger (task 4)

Use the **empty-string-safe** form for the PRIMARY signal. Either of these is acceptable; the first keeps the design's explicit-GUC style, the second is the shortest Supabase-idiomatic form:

**Recommended (explicit, matches design intent):**
```sql
if coalesce(
     nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
     ''
   ) = 'service_role'
   or current_user in ('service_role', 'postgres', 'supabase_admin') then
  return new;
end if;
```

**Equivalent (Supabase helper, inherently empty-string-safe):**
```sql
if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
   or current_user in ('service_role', 'postgres', 'supabase_admin') then
  return new;
end if;
```

The **only** change from the design's text is wrapping the GUC read in `nullif(…, '')` (or using `auth.jwt()`); the role values (`service_role`), the secondary `current_user` list, the `42501` errcode, and `security invoker` all stand confirmed.

---

## 3. Confirmation against the design's stated expression

| Design assumption | Verdict |
|-------------------|---------|
| `request.jwt.claims` is the populated claim helper on the live DB | ✅ Confirmed (PostgREST GUC; `auth.jwt()`/`auth.role()` also exist) |
| `…::json ->> 'role'` returns `service_role` under service key | ✅ Confirmed |
| returns `authenticated`/`anon` under client connections | ✅ Confirmed |
| SECONDARY signal `current_user in ('service_role','postgres','supabase_admin')` | ✅ Confirmed — management/migration connection is `postgres` |
| Design's **raw** `current_setting(...)::json` expression as written | ⚠️ **Needs adjustment** — throws `22P02` on an empty-string GUC. Apply `nullif(...,'')` (or use `auth.jwt() ->> 'role'`) before applying task 4. |

**Conclusion:** The claim is exposed exactly where the design expects it and resolves correctly per connection type, so the SEC-001 trigger approach is sound. Task 4 MUST use the empty-string-safe expression above instead of the bare `current_setting('request.jwt.claims', true)::json ->> 'role'`. The secondary `current_user` signal is confirmed (`postgres`).

---

## 4. Limitations

- The Supabase MCP runs every query through the **management/service connection as the `postgres` role**; it cannot establish a true anon-key or service-key PostgREST HTTP session. Role-claim resolution was therefore verified by reproducing PostgREST's exact injection mechanism (`set_config('request.jwt.claims', …, true)`), not by two separate live key connections.
- Consequently the `current_user` value for a *real* service-role PostgREST connection (design expects `service_role`) could not be directly observed here; what was observed is `postgres` (the migration/admin context). This is already an accepted secondary value, and the PRIMARY JWT-claim signal — which is what a service-role PostgREST connection actually relies on — is confirmed to resolve `service_role`.
- A full end-to-end confirmation under live anon + service keys is covered by the RLS-level integration tests (tasks 8/16) in the CI `integration-e2e` job.

## 5. Gate decision

✅ **PASS — proceed to task 4**, with the mandatory adjustment that task 4's trigger uses the empty-string-safe expression from section 2. No migration was applied (verification only).
