# Staff provisioning — build round 1

Read `AGENTS.md`, `artifacts/api-server/AGENTS.md`, `artifacts/store/AGENTS.md`, `supabase/AGENTS.md`,
the spec `docs/tasks/staff-provisioning.md` and the approved design note
`docs/design-notes/staff-provisioning.md` **including its §12 review — amendments A1 and A2 there are
binding and override the note's earlier sections where they differ.**

Branch `phase/staff-provisioning`; it is checked out. Never commit to `main`. Commit locally; do not
push. **Do not touch any Supabase project and do not run SQL** — the architect applies migrations to
the test project after review. **Do not edit any existing file under `supabase/migrations/`.**

`origin/feat/staff-provisioning` holds earlier, unreviewed code for this phase. Use it as reference
only (`git show origin/feat/staff-provisioning:<path>`); the note's §8 says per file what is kept.
Do not merge or rebase that branch.

If any instruction below turns out to be wrong against the code (a name, a line, a column that does
not exist), **stop on that item**, write it under *Blocked* in the notes file, and go on with the
others. Do not guess a different fix. Never invent a column, route, key or setting name.

One commit per numbered item, message `<type>(<scope>): <what changed>`.

## 1. Migration: `audit_log` under version control (A2)

`audit_log` exists on the test project but in no tracked migration. New file
`supabase/migrations/20261118120000_audit_log_tracked.sql`, exactly the live shape (read by the
architect from the test project on 2026-11-18):

```sql
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  changes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx  ON public.audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log (created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
```

No policy here: `audit_admin_read` is already created by
`20260627111906_sec005_is_admin_helper_and_policies.sql`. A header comment says why the file exists.

## 2. Migration: there is always an admin

`supabase/migrations/20261118120100_users_keep_one_admin.sql` — the function and trigger of the
note's §2, as written there (`ensure_an_admin_remains`, `trg_users_keep_one_admin`,
`AFTER UPDATE OF role OR DELETE`, `WHEN (OLD.role = 'admin')`, advisory lock, `ERRCODE = 'ST040'`).
Add `SET search_path = ''` to the function. Not `SECURITY DEFINER`.

## 3. Migration: `set_user_role` and `find_auth_user_by_phone`

`supabase/migrations/20261118120200_set_user_role.sql`, per the note's §3:

- `public.set_user_role(p_actor uuid, p_user uuid, p_role text) RETURNS text` — returns the old role.
  `SELECT role … FROM public.users WHERE id = p_user FOR UPDATE`; no row → `RAISE EXCEPTION` with
  `ERRCODE = 'ST041'` (the route maps it to 404). Same role → return it, write nothing. Otherwise
  `UPDATE` the role and `INSERT INTO public.audit_log (actor_id, action, entity, entity_id, changes)`
  `VALUES (p_actor, 'change_user_role', 'user', p_user, jsonb_build_object('old_role', …, 'new_role', p_role))`
  in the same function. `p_role` outside `customer|staff|admin` → the existing CHECK raises; leave it.
  `LANGUAGE plpgsql`, **not** `SECURITY DEFINER` (the service role calls it, which is what
  `enforce_role_immutability` admits), `SET search_path = ''`.
- `public.find_auth_user_by_phone(p_phone text) RETURNS uuid` — `SECURITY DEFINER`,
  `SET search_path = ''`, `SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1`. The caller
  passes the digits-only form (auth stores phones without `+`).
- For both: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;`
  `GRANT EXECUTE ON FUNCTION … TO service_role;` — the invariant
  `security-definer-service-role-privileges` checks this shape; make it pass.
- `ST041` must be unused: `git grep ST041` before you choose it; if taken, pick the next free
  `ST04x` and say so in the notes.

Then add both functions to `artifacts/supabase-types/src/database.types.ts` under
`public.Functions`, in the generator's format (copy the shape of an existing entry there).

## 4. `isBypassPhone`

`artifacts/api-server/src/lib/otp.ts`: export
`isBypassPhone(phone: string): boolean` = `TEST_PHONES.has(normalizePhone(phone))`. Do not change
`TEST_PHONES`, `TEST_CODE` or `verifyOTP` — the bypass stays in the test environment by the owner's
decision (2026-11-18).

## 5. The three routes

Rewrite `artifacts/api-server/src/routes/admin/users.ts` per the note's §3, item by item: `GET`,
`POST /admin/users`, `PATCH /admin/users/:id/role`; all `requireAdmin`; Zod input and output; error
**codes** (`invalid_search`, `invalid_phone`, `phone_reserved`, `phone_ambiguous`, `already_staff`,
`auth_create_failed`, `cannot_demote_self`, `not_found`, `last_admin`), never sentences. Role changes
go only through `set_user_role` (`.rpc(...)`); map `ST040` → 409 `last_admin`, `ST041` → 404
`not_found`. The `createUser` failure path calls `find_auth_user_by_phone`, **never** `listUsers`.
No `as any` anywhere in the file — `users` and the two functions are in `database.types.ts`.

Do **not** change `routes/auth.ts`; its sign-in fix already shipped (#21).

## 6. The admin shell opens to staff (A1)

`artifacts/store/src/pages/admin/AdminLayout.tsx`: line ~106 sets `authed` only for
`role === "admin"`. Make it admit `staff` and `admin`. `navItems` already has an `adminOnly` flag
(see `bundles`) and a role filter at line ~188 — extend that, do not invent a second mechanism.

Which entries staff see is decided by the API, not by taste: for each admin page, list the API
routes it calls and their guard (`requireAdmin` vs `requireStaffOrAdmin` in
`artifacts/api-server/src/routes/`). An entry is visible to staff **only if every route its page
calls is `requireStaffOrAdmin`**; every other entry gets `adminOnly: true`. Expected staff set:
counter, inventory, reservations, stocktakes — confirm or correct it from the code, and put the
table (page → routes → guards → visible to staff?) in the notes file.

- The dashboard (`/admin`) is admin-only. A staff user opening `/admin` is sent to `/admin/counter`.
- A staff user opening any admin-only path sees a "not available" panel (new i18n key in az, ru, en),
  not the page. The API guards remain the real boundary.
- Do **not** widen any API guard.

## 7. The screen

`/admin/users` per the note's §7: `UsersPage.tsx` (list, role filter, search, paging; ≤ 150 lines),
`UserRoleControl.tsx` (per row; disabled with an explanation on the caller's own row), and the
existing `AddStaffModal.tsx` from the old branch. Each API error code maps to
`Admin.Users.error.<code>` in `az.ts`, `ru.ts` and `en.ts`. No new file over 200 lines. Use platform
elements (`<dialog>`, `<select>`, `<input type="tel">`) over hand-rolled widgets.

## 8. Invariant

`scripts/audit/check-invariants.mjs`: bring over `no-auth-metadata-role-reads` from the old branch
as it is, and add `role-written-only-by-users-route`: under `artifacts/api-server/src/`, no file but
`routes/admin/users.ts` names `set_user_role`, and no file writes a `role` key to `users`
(`.update({ … role`, `.upsert({ … role`, `.insert({ … role` on `from("users")`). It must pass on the
current tree (`routes/auth.ts` no longer writes `role`).

## 9. Tests

- Bring over from the old branch, per the note's §8: `invariant-no-auth-metadata-role-reads.test.ts`
  and `require-staff-or-admin-role-source.test.ts` unchanged; `admin-staff-management.test.ts` with
  the i18n case extended to the new keys; `admin-routes.test.ts` route inventory;
  `tests/admin-users.test.ts` with its `as any` typed, extended to: shopper and staff tokens get 403 on
  all three routes; bypass phone refused; unknown id 404 with no audit line.
- New integration tests in `artifacts/api-server/tests/serial/` (they need the database; you cannot
  run them): new phone → staff; customer promoted keeps orders; same phone in another format refused;
  demoting the only admin refused by the database for the service role; two concurrent
  cross-demotions (`Promise.all`, two clients) leave one admin; demoted staff's next admin request 403.
  Every user a test creates uses a random phone outside the three bypass numbers.
- E2E `artifacts/store/tests/e2e/staff-access.spec.ts`: a staff session (bypass phone
  `+994550000002`, which is `staff` on the test project; sign in the way `tests/helpers/admin-auth.ts`
  does) sees the counter and inventory entries and no Users, Orders or Settings entry, and `/admin`
  lands on the counter. Do not change the existing admin setup project.
- Never delete, rename or `.skip()` an existing test.

## Definition of done

- `pnpm run typecheck`, `pnpm run audit:invariants:strict` and `pnpm test:unit` pass.
- `docs/audits/staff-provisioning-notes.md`: what each commit changed; the A1 table from item 6;
  **Blocked / Assumptions / Not verified**; every test added, moved or changed by name; and the
  **real output** of the three commands above, pasted, not summarised.
- State plainly that the `api-integration`, serial and E2E tiers were **not run** — they need
  credentials and a running server and run in CI. Do not claim they passed.
