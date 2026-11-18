# Design note: staff provisioning

> **Status:** approved with amendments A1–A2 (review 2026-11-18, §12). No code written yet.
> **Author:** architect (main session), 2026-11-15. **Branch:** `design/staff-provisioning`.
> **Spec:** `docs/tasks/staff-provisioning.md`. **Base:** `main` at `b351412`.
> **Evidence read:** `feat/staff-provisioning` at `e85745d` — route, page, modal, all four test files,
> the invariant. Test project `jcvsnoiacrknzejouxah` queried read-only.

## 0. Decisions in one screen

| Question (spec §10) | Answer |
|---|---|
| 1. Always an admin | `AFTER UPDATE OF role OR DELETE` row trigger on `users`, `WHEN (OLD.role = 'admin')`, that takes one transaction-scoped advisory lock and then counts admins. Interleaving in §2 |
| 2. Find by phone | `users.phone` by both stored formats with `.in()`; for an auth user with no `users` row, a service-role-only SQL function reads `auth.users` by phone. No `listUsers` |
| 3. Filter and search | In the query. Search input validated to a safe character set |
| 4. Bypass phones | `otp.ts` exports `isBypassPhone()`; the set stays in one place |
| 5. Demoted mid-task | Next request 403; nothing half-written (§6) |
| 6. Branch tests | Two kept as they are, two kept and extended, one rewritten (§8) |

One proposal beyond the spec: **the role change and its audit line are one database call**, a function
`set_user_role`, instead of an update followed by the fire-and-forget `writeAudit`
(`lib/audit.ts:46-60`, not awaited). Today a refused update still writes an audit line (§9.2), and a
lost audit insert is silent. One transaction makes both impossible and gives the route the old role
and "not found" for free. Cost: one function; the route stays thin.

## 1. What holds today (read, not assumed)

- `users.id` references `auth.users ON DELETE CASCADE` (`schema.sql:24`; on the test project the one
  FK has `confdeltype = c`). **A `users` row whose auth user was removed cannot exist** — spec §7's
  third mismatched state does not occur.
- `users.phone` is `text unique`; `role` has `CHECK (role IN ('customer','staff','admin'))`
  (`20261102100000_m1_variants_ledger.sql:8`).
- `enforce_role_immutability` (`schema.sql:73-97`) lets only `service_role`/`postgres`/`supabase_admin`
  change `role`. `requireAdmin` (`lib/supabase.ts:33`) and `requireStaffOrAdmin`
  (`middlewares/requireStaffOrAdmin.ts:19`) read `users.role` with the service client per request.
- Sign-in (`routes/auth.ts:47-110`) looks a user up by `normalizePhone` only; when that misses and
  `createUser` fails it pages `listUsers({ perPage: 1000 })` — the same ceiling as §9.4, on `main`.
  It then upserts the row with the canonical phone, so a legacy `994…` row is rewritten on sign-in.
- Test project: 100 `users` rows; 55 `admin`, 4 `staff`, 41 `customer`; one row with a non-`+`
  phone; **one bypass phone holds `admin` and one holds `staff`**; 0 auth users without a row.
- E2E signs in as `+994550000001` with `999999` (`tests/e2e/admin-panel.spec.ts:37`,
  `counter-sale.spec.ts:28,118`) and relies on that row being `admin` in the test project.
- The store database's `audit_log` (`id, actor_id, action, entity, entity_id, changes, created_at`)
  is on the test project but in **no tracked migration** — `schema.sql:40` mentions it, and the
  only `CREATE TABLE audit_log` in the repository is the control plane's. Drift, recorded under §10.

## 2. Always an admin — the mechanism (spec §5)

```sql
-- one migration, one concern
CREATE FUNCTION public.ensure_an_admin_remains() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.users.admin_count'));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = 'ST040';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_users_keep_one_admin
  AFTER UPDATE OF role OR DELETE ON public.users
  FOR EACH ROW WHEN (OLD.role = 'admin') EXECUTE FUNCTION public.ensure_an_admin_remains();
```

Interleaving it defeats — admins A and B, each demotes the other at once (READ COMMITTED, the default):

1. T1 `UPDATE … SET role='customer' WHERE id=B`; T2 the same for A. Different rows: no row lock conflict.
2. Both AFTER triggers fire. T1 takes the advisory lock; T2 waits on it.
3. T1's `EXISTS` runs with a snapshot taken *after* the lock: sees A still admin (T2 uncommitted) → passes, commits, lock released.
4. T2 acquires the lock. Its `EXISTS` is a new statement, so a new snapshot: B is `customer` (T1 committed) and A is `customer` (its own change) → raises → T2 rolls back. One admin remains.

Why it holds: the count always runs after the lock, and in plpgsql under READ COMMITTED each statement
takes a fresh snapshot, so whoever runs second sees the first one's commit. A deferred constraint
trigger without the lock does **not** hold: both checks would run before either commit and both would
pass. It fires for every writer: service role, `postgres`, and the cascade from deleting an auth user.
`WHEN (OLD.role = 'admin')` keeps it off every other update, including profile edits. The function is
not `SECURITY DEFINER`: it reads `users` as whoever wrote it, and every writer of `role` is privileged.
The error code `ST040` follows the `STxxx` family of the warehouse triggers and is unused (`git grep`).

## 3. Routes

All `requireAdmin`; Zod for input and output; error codes, not sentences; no `as any` (`users` is in
`database.types.ts`, `auth.admin` is typed by supabase-js).

- **`GET /admin/users?page&role&q`** — `role` ∈ the three; `q` ≤ 50 chars matching
  `^[\p{L}\p{N} +\-.']*$`u, else 400 `invalid_search`. Then `.or(full_name.ilike…,phone.ilike…)` is safe:
  none of `,()` can reach it. §9.5 is **also on `main`** (`routes/admin/users.ts:21-24`); this fixes both.
- **`POST /admin/users { phone, full_name?, role: 'staff' | 'admin' }`**
  1. `normalizePhone` + `validateAzPhone` → 400 `invalid_phone`. `isBypassPhone` → 400 `phone_reserved`.
  2. `users` where `phone IN (canonical, digits-only)` (`.in()`, not an `or` string). Two rows → 409
     `phone_ambiguous` (reachable only through legacy data). One row with `staff`/`admin` → 409
     `already_staff`. One `customer` row → promote via `set_user_role` (orders untouched).
  3. No row: `auth.admin.createUser({ phone, phone_confirm: true })`. On error, call
     `find_auth_user_by_phone(p_phone)` — `SECURITY DEFINER`, `search_path = ''`, returns `id` from
     `auth.users` where `phone` is the digits-only form, `EXECUTE` granted to `service_role` only. Found
     → that id; not found → 502 `auth_create_failed` (the error is logged, not returned).
  4. Insert the `users` row as `customer` (`ON CONFLICT (id) DO NOTHING`), then `set_user_role`. One
     writer of `role`. 201 with the row.
- **`PATCH /admin/users/:id/role { role }`** — `id` is a uuid → 400. Self-demotion → 400 `cannot_demote_self`
  (the screen explains it; the database guard is the real one). Target's phone `isBypassPhone` and
  role ≠ `customer` → 400 `phone_reserved`. `set_user_role` → 404 `not_found` if no row, 409 `last_admin`
  on `ST040`, 200 with `{ old_role, new_role }`. Same role → 200, no audit line.

`set_user_role(p_actor uuid, p_user uuid, p_role text) RETURNS text` (old role): `UPDATE … RETURNING`
the old value via a `SELECT … FOR UPDATE` first, insert `audit_log (actor_id, action 'change_user_role',
entity 'user', entity_id, changes {old_role, new_role})` in the same transaction; `EXECUTE` to
`service_role` only. The actor id is stored, never the actor's role, so a later demotion of the actor
does not change what the line says.

## 4. Bypass phones (spec §6)

`otp.ts` exports `isBypassPhone(phone) = TEST_PHONES.has(normalizePhone(phone))`. One list. If the
production fix (`fix/otp-bypass-production`, `fef34e1`, not merged) lands, the set is empty in
production and the check becomes a no-op there — safe, because the code `999999` then works nowhere in
production. If it does not land, the set is non-empty and the routes refuse. Safe both ways.

E2E keeps its sessions without weakening either rule: the routes refuse bypass phones, but the test
project's roles are **seeded by the service client** in E2E setup (`+994550000001` admin,
`+994550000002` staff), the way `counter-sale.spec.ts` already reads that row. The seed runs only
against the test project, outside production by construction.

## 5. Readers and writers of `role`

The invariant (spec §11.5): no file under `artifacts/api-server/src/` other than
`routes/admin/users.ts` names `set_user_role`, and no file there writes a `role` key to `users`
(`.update({ … role`, `.upsert({ … role`, `.insert({ … role` on `from("users")`).

**A defect on `main` this exposes:** `routes/auth.ts:98-102` upserts `{ id, phone, role: "customer" }`
`ON CONFLICT (id)` with the service client whenever the lookup by canonical phone misses. For a staff
or admin row stored in the legacy `994…` format, that lookup misses, the recovery path finds the same
auth id, and the upsert **demotes them to `customer` on sign-in** — the trigger allows it, the writer
is the service role. Fix: drop `role` from that upsert (the column default is `customer` for a new
row). That also leaves the invariant without an exception. Rare (one non-`+` row on the test project,
a customer), but real.

## 6. Every rule — ordinary flow and intersections (spec §7)

| Rule | Ordinary | Meets |
|---|---|---|
| Add by phone | Owner types `055 123 45 67`, "Aysel", Staff → `+994551234567` row, staff | `+994…`, `994…`, `0…` normalize to one; legacy `994…` row found by `.in()`; customer with orders → promoted |
| Promote, don't duplicate | Last year's buyer becomes staff, same `id`, orders kept | Auth user without row (0 on test project) → `find_auth_user_by_phone`; row without auth user impossible (cascade) |
| Demotion immediate | Cashier removed; next click 403 | Counter sale: the till posts in one call (`post_counter_sale`); a cart not yet posted is browser state, so nothing is half-written. Stocktake: lines already scanned stay, attributed to them (`counter_id`), and the owner can post or delete them; further inserts fail RLS (`stocktake_lines` "staff draft insert" requires `role = 'staff'`) |
| Always an admin | Partner made admin, later removed | §2; sole admin's own row: 400 from the route, `ST040` from the database |
| Staff see no cost | New staff open inventory: no cost, no reorder | This phase adds no field to any staff response; `GET /admin/users` is admin-only |
| Audit trail | "Who made X admin?" — `audit_log` row with actor, old, new | Actor later demoted: the row stores the actor's id, unchanged |

## 7. Screen

`/admin/users`: list (role filter, search, paging), "Add staff" modal, a role control per row; the
caller's own row shows the control disabled with a tooltip. The branch's page is 274 lines; split into
`UsersPage.tsx` (list, ≤ 150), `UserRoleControl.tsx` and the existing `AddStaffModal.tsx` (117). Error
codes map to `Admin.Users.error.<code>` keys in `az`, `ru`, `en`. `modern-web-guidance` first.

## 8. The branch, file by file

| File at `e85745d` | Decision |
|---|---|
| `routes/admin/users.ts` | Rewritten per §3. §9.1–9.7 all **confirmed**; also: `.or()` + `.maybeSingle()` (line 73) returns 500 if both formats exist; `role` defaults to `staff` silently |
| `AddStaffModal.tsx` | Kept; error codes instead of server messages |
| `UsersPage.tsx` | Split (§7) |
| `invariant-no-auth-metadata-role-reads.test.ts`, `require-staff-or-admin-role-source.test.ts` | **Kept as they are** |
| `check-invariants.mjs` `no-auth-metadata-role-reads` | Kept; new `role-written-only-by-users-route` added |
| `tests/admin-users.test.ts` (6 cases, mocks) | Kept, extended to §9's list; the `as any` on line 18 typed |
| `admin-staff-management.test.ts` | Kept; the i18n case extended to the new error keys |
| `admin-routes.test.ts` (+POST route) | Kept |

## 9. Commits

1. Migration: always-an-admin trigger. 2. Migration: `set_user_role`, `find_auth_user_by_phone`.
3. `isBypassPhone`. 4. Routes. 5. `auth.ts` drops `role` from its upsert. 6. Screen + dictionaries.
7. Invariant. 8. Tests: unit (route with a mocked client: 403 for shopper and staff tokens, bypass
refused, unknown id 404 with no audit line); integration in `tests/serial/` (new phone → staff;
customer promoted keeps orders; same phone in another format refused; demoting the only admin refused
for the service role; two concurrent cross-demotions — two clients, `Promise.all` — leave one admin;
demoted staff's next request 403). E2E: owner adds staff, staff sees inventory without cost.
9. `docs/audits/staff-provisioning-notes.md`.

## 10. Blocked / Assumptions / Not verified

**Blocked:** none for the note. Commit 1 cannot be applied to a database with **zero** admins without
first creating one — the test project has 55, production unknown.

**Assumptions:** PostgREST runs requests in READ COMMITTED (Postgres and Supabase default); the
advisory key collides with nothing: the only other advisory locks use the two-`int` form
(`20261104110000_m2a_functions_triggers.sql:350`), a separate key space. The test project's 55 admins are fixtures; this phase does not clean them.

**Not verified:** whether a bypass phone holds a role in **production** (no access; on the test
project two do). The §2 trigger and both functions have not been run — they will be created in a
rolled-back transaction before I ask to apply them. `audit_log` has no tracked DDL; `set_user_role`
depends on its columns as read from the test project. The customer has not been asked whether three
roles are enough.

## 11. Spec points that do not match the code

- §7 "a `users` row whose auth user was removed": cannot exist (cascade).
- §9.3 "six new `as any`": confirmed — five new in the route (eight there, three on `main`) and one in the test.
- §14 "whether §9.5 is also on `main`": it is.
- Not in the spec: `routes/auth.ts:98-102` can demote a legacy-format staff or admin row on sign-in (§5).

Files over 200 lines: none planned. Tests deleted: none.

## 12. Review — 2026-11-18 (architect, on the owner's delegation)

The owner delegated this review ("review/audit yourself and proceed"). Every claim below was
checked against `main` at `ab4afaa`. **Verdict: approved, with A1 and A2 binding.**

Confirmed: §1's role default and immutability trigger (`schema.sql:29,73-97`); §5's demotion on
sign-in (`routes/auth.ts:98-102`); §2's interleaving (AFTER ROW trigger, lock before the count,
fresh snapshot per statement under READ COMMITTED — a single `UPDATE` demoting every admin also
raises, because AFTER ROW triggers run after the whole statement).

- **A1 — staff cannot enter the admin shell (binding).** `AdminLayout.tsx:105-107` sets `authed`
  only for `role === "admin"`. The spec's ordinary flow (§7: "the cashier signs in … and sees the
  admin") and this note's own E2E ("staff sees inventory without cost", §9) cannot pass without
  changing it, and §7 here only covers `/admin/users`. Add to this phase: the shell admits `staff`
  and `admin`; each `navItems` entry carries the roles that may see it, derived from the guard of
  the API routes its page calls (`requireStaffOrAdmin` today: counter, counter sales, receipts,
  reservations, stocktakes, suppliers, bundles, inventory signals, `routes/inventory.ts`); a staff
  user opening an admin-only path gets a "not available" panel, not the page. The API guards stay
  the real boundary; the shell only stops staff landing on screens that would 403. Do **not**
  widen any API guard in this phase (`PATCH /admin/orders/:id/status` stays `requireAdmin`; the
  delivery-cost phase decides that). E2E: a staff session sees the counter and inventory entries
  and no Users, Orders or Settings entry.
- **A2 — `audit_log` has no tracked DDL (binding).** `set_user_role` inserts into it, and
  `20260627111906_sec005_is_admin_helper_and_policies.sql` already drops and creates a policy on
  it, so a database built from `supabase/migrations/` alone has no table for either. Before
  commit 2, one migration `CREATE TABLE IF NOT EXISTS public.audit_log` with the columns read from
  the test project (§1 lists them; confirm types with the `schema-drift-check` skill and stop if
  they differ), RLS enabled, timestamped after the newest file.
- **A3 — commit 5 is done.** The sign-in demotion fix shipped on its own as
  `fix/sign-in-keeps-role` (PR #21). Drop it from §9; the invariant in commit 7 still guards it.
- **A4 — recommended.** Sign-in's recovery still pages `listUsers({ perPage: 1000 })`
  (`routes/auth.ts`); use `find_auth_user_by_phone` there in the same commit as the routes.
- **A5 — the bypass stays in the test environment** (owner, 2026-11-18). §4's "safe both ways"
  holds as written; the production gate is recorded in `docs/knowledgebase/supabase-projects.md`.
- **A6 — start from `main`.** `feat/staff-provisioning` is 183 commits behind; the phase branch is
  cut fresh from `main` and the files §8 keeps are brought over, not rebased.

Order: this phase before M4b, which relies on A1 for its staff view.
