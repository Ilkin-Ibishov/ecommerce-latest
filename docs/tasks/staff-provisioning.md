# Staff provisioning: the owner gives a person a role

Status: active — design note on `design/staff-provisioning`, waiting for the owner's review. Blocks M4b.

Spec, 2026-11-15. Written by the architect.

Code for this already exists on `feat/staff-provisioning` (`29fc841..e85745d`, five commits split off
the M4 branch; see `docs/archive/audits/m4-architect-audit.md`, "Split of the non-M4 work"). It was written
without a spec and is **not mergeable as it stands** (§9). Treat it as evidence of what is wanted,
not as a starting commitment: the design note says, per file, what is kept, changed and removed.

## 1. Why this exists

Every warehouse phase since M2a separates what staff may see from what the owner may see: cost,
margin, expected quantities, the reorder list. None of that means anything until the owner can make
someone staff. Today the only way is to edit `users.role` by hand in the database.

## 2. Scope

One screen (`/admin/users`) and three routes (`GET`, `POST /admin/users`,
`PATCH /admin/users/:id/role`). The owner adds a person by phone number as `staff` or `admin`,
changes a role, or takes it away. Nothing else (§12).

## 3. The invariant that defines this phase

> **A role exists in exactly one place — `public.users.role` — and is read from there on every
> request. Only the service role writes it, and only through this phase's routes.**

Two halves of this already hold and must not be weakened:

- `enforce_role_immutability` (`supabase/schema.sql`) rejects any role change that does not come
  from the service role, and `authenticated` has `UPDATE` on `full_name` and `default_address` only.
- `requireAdmin` (`artifacts/api-server/src/lib/supabase.ts`) reads `users.role` with the service
  client on each request, not from the token. `user_metadata` is writable by the user who owns it;
  a role read from there is a role anyone can give themselves.

`authenticated` in this product is every signed-in shopper. Every route here is `requireAdmin`.

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Three roles, as the column already allows:** `customer`, `staff`, `admin`. No permissions
  table, no per-screen switches.
- **A person is identified by phone.** Sign-in is by one-time code to that phone, so whoever holds
  the phone holds the role. The owner types the number; there is no invitation and no message.
- **Adding an existing customer promotes that account.** Their orders and profile stay.
- **Removing a role is a demotion to `customer`.** No user is deleted in this phase.
- **A demotion takes effect on the person's next request.** That follows from §3 and needs no
  session revocation; a test proves it.
- **Only `admin` manages roles.** Staff cannot open the screen or call the routes.
- **Every change is written to the audit log** with the actor, the old role and the new role.

## 5. There is always an admin

A shop with no admin cannot be repaired from inside the product.

- The route refuses to demote the caller. That is not enough: two admins who demote each other at
  the same moment both pass that check.
- So the rule lives in the database: no transaction may commit leaving zero rows with
  `role = 'admin'`. It must hold under two concurrent demotions, not only under one — the design
  note names the mechanism and why it is race-free, and an integration test runs the two at once.
- It applies to every writer, including the service role and a row deletion.

## 6. A test phone never holds a role

`artifacts/api-server/src/lib/otp.ts` accepts the fixed code `999999` for three hard-coded phone
numbers "in any environment" (its own comment), and exempts them from rate limits. With this phase
an admin can type one of those numbers into the form; from then on anyone who knows the code is
staff or admin of that shop.

- The provisioning route refuses a bypass phone for any role above `customer`, and so does the
  role-change route for an account whose phone is one.
- Independently of this phase, the bypass must not work where `NODE_ENV` is `production`. That is
  a one-line fix on `main` and the architect raises it with the owner separately; this phase must
  be safe even if it is not made.
- E2E needs a staff session. The design note says how the test environment gets one without
  weakening either rule above.

## 7. Every rule: ordinary flow and intersections

For each rule the design note writes both answers. The ones already visible:

| Rule | Ordinary flow | Meets |
|---|---|---|
| Add by phone | Owner types the cashier's number and name, picks Staff. The cashier signs in with a code and sees the admin | Phone formats: `+994…`, `994…`, `0…` must reach one account, not two. A number that already has orders as a customer |
| Promote, don't duplicate | The cashier already bought something here last year; the same account becomes staff | `users.id` equals the auth user id; an auth user with no `users` row; a `users` row whose auth user was removed |
| Demotion is immediate | Owner removes a cashier who left; their open tab gets 403 on the next click | M3a: a counter sale they have open and unposted. M2b: a stocktake they are counting |
| Always an admin | Owner makes their partner admin, later removes them | Two admins acting at once (§5). The sole admin's own row |
| Staff see no cost | New staff open inventory: no cost, no margin, no reorder list | M2a cost privacy, M2b blind counting, M4 reorder is admin-only — nothing in this phase may add a field to a staff response |
| Audit trail | "Who made this person admin?" has an answer | The actor is later demoted: the log line still names them |

## 8. Where it appears

- `/admin/users`: the list with role, a filter by role, "Add staff", and a role control per row.
  The caller's own row cannot be demoted and the control says why.
- `az`, `ru` and `en` keys for every label and every error the screen can show. The API returns
  error codes; the screen owns the words.
- Frontend work follows `.agents/rules/frontend.md`: `modern-web-guidance` first.

## 9. What is wrong on the branch today

Found by reading `artifacts/api-server/src/routes/admin/users.ts` at `e85745d`. The design note
confirms or refutes each against the code.

1. No database guard for §5; the only protection is the caller-cannot-demote-self check.
2. `PATCH /admin/users/:id/role` ignores the error and the row count of its update: an unknown id,
   or a refused write, returns `{ success: true }` and writes an audit line for a change that did
   not happen. The id is not validated.
3. Six new `as any` (`AGENTS.md` forbids them): five on the service client in the route, one in
   `tests/admin-users.test.ts`. `users` is in `database.types.ts` and `auth.admin` is typed.
4. When `auth.admin.createUser` fails, the route lists the first 1000 auth users and searches them
   for the phone. A shop with more accounts than that cannot add an existing customer whose `users`
   row is missing; and any other creation error takes the same path.
5. The search box value is interpolated into a PostgREST `or(...)` filter string. A comma or a
   parenthesis in it changes the filter. Admin-only, so low severity, but it is not validated.
6. Nothing stops §6.
7. The audit line for a role change records the new role only.

## 10. Open questions — answer in the design note, before any migration

1. The mechanism for §5, with the interleaving it defeats written out.
2. How an existing account is found by phone without paging through auth users (§9.4), and what
   the route does in each of the three mismatched states in §7's second row.
3. Whether the role filter and search are done in the query or in the page, at this shop's size.
4. How §6 is enforced without a second copy of the phone list.
5. What a staff member with an open counter sale or stocktake sees when demoted mid-task, and
   whether anything is left half-written. State it; do not build a recovery flow.
6. Which existing tests on the branch are kept as they are.

## 11. Deliverables, in order

1. **Design note first** at `docs/design-notes/staff-provisioning.md`, answering §10, confirming §9
   and repeating §7 for every rule. Commit it and **stop** for review.
2. The always-an-admin guard: one migration, one concern.
3. The three routes: Zod-validated input and output, error codes, no `as any`.
4. The screen.
5. Invariants in `scripts/audit/check-invariants.mjs`: keep `no-auth-metadata-role-reads`; add one
   that fails when any file under `artifacts/api-server/src/` other than this phase's route writes
   `role` to `users`.
6. Tests at every tier. At least: a shopper's token and a staff token get 403 on all three routes;
   a new phone becomes staff; an existing customer is promoted and keeps their orders; a second add
   of the same phone in another format is refused, not duplicated; demoting the only admin is
   refused by the database for the service role too; two concurrent cross-demotions leave one
   admin; a bypass phone is refused; a demoted staff member's next admin request is 403; an unknown
   id returns 404 and writes no audit line.

## 12. Not in this phase

| Not built | Re-open when |
|---|---|
| Per-screen or per-action permissions | A shop needs a role between staff and admin |
| Invitations, or any message to the new staff member | Owners report that telling the person by voice is not enough |
| Deleting a user | A data-removal request arrives; it is a privacy feature, not a staffing one |
| Password or email sign-in for staff | A shop has staff without their own phone |
| Staff activity reports | The audit log is not enough for an owner's question |

## 13. Definition of done

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. The migration applied
to the test project. Integration and E2E green in CI. `docs/audits/staff-provisioning-notes.md`
states which tiers ran. No new file over 200 lines without the reason in the design note
(`UsersPage.tsx` is 274 on the branch).

## 14. What is not verified

§9 was read from one file at `e85745d`; the screen, the modal and the branch's tests were not read.
Whether §9.5 is also on `main` was not checked. Whether any bypass phone holds a role in a
production database was not checked — the architect has no access to one. The customer has not
been asked whether three roles are enough.
