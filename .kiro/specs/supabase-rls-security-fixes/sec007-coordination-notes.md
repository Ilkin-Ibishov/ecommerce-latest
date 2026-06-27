# SEC-007 Coordination Notes — control-plane browser usage reconciliation (task 20.3)

**Spec:** `.kiro/specs/supabase-rls-security-fixes` (bugfix)
**Task:** 20.3 — document the `super-admin-platform` coordination; do NOT delete `client.ts`.
**Design:** Property 7 (no control-plane credential in the browser); Requirements 2.7, 2.10.

---

## Cross-spec dependency

`artifacts/store/src/lib/platform/client.ts` (`getControlPlaneClient()`) constructs a
**browser** Supabase client for the control-plane project from
`VITE_CONTROL_PLANE_SUPABASE_URL` / `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY`. This file
belongs to the SEPARATE `super-admin-platform` feature — it is NOT owned by this
security-fixes spec. The `/platform/*` super-admin auth/data flows currently depend on it.

Because of that ownership boundary, this spec does **NOT** unilaterally delete `client.ts`.
Deleting it here would break the `super-admin-platform` feature out from under its own spec.

## Chosen resolution (to be implemented under `super-admin-platform`)

Route `/platform/*` data/auth flows behind **API-server control-plane endpoints backed by
the control-plane service role** (mirroring how `getAdminSupabase()` works for the store
project, but pointed at the control-plane Supabase project). Once `super-admin-platform`
lands that server-side routing, the browser control-plane client in `client.ts` can be
removed entirely. Until then, the dependency is documented here and tracked against that spec.

## What this spec actually enforces (the browser-side guarantee)

The enforceable, browser-side guarantee delivered by THIS spec is the **credential removal**
(task 20.1): `VITE_CONTROL_PLANE_SUPABASE_URL` and `VITE_CONTROL_PLANE_SUPABASE_ANON_KEY`
are removed from `vercel.json` `build.env`, so Vite no longer inlines a control-plane
credential into the storefront bundle shipped to every visitor. With the credential gone,
`getControlPlaneClient()` can no longer be constructed with a live key in production builds,
neutralizing the network-reachability concern even before `super-admin-platform` completes
the server-side routing.

Defense in depth, also delivered here:
- **Deny-by-default assertion migration** `supabase/control-plane/migrations/009_assert_deny_by_default.sql`
  (task 20.2) fails closed if any control-plane `public` table has RLS disabled or if any
  policy exists on the `public` schema. So even an accidental leaked credential reads/writes
  nothing on the control-plane DB.

## Explicit dependency statement

> The full removal of `artifacts/store/src/lib/platform/client.ts` and the move of
> `/platform/*` flows to API-server control-plane (service-role) endpoints is OWNED BY and
> DEPENDS ON the `super-admin-platform` spec. This security-fixes spec's enforceable
> contribution is the browser credential removal (task 20.1) plus the deny-by-default
> assertion (task 20.2). `client.ts` is intentionally left in place.

## Live-schema reconciliation (task 20.2 / 2.10) — DB connectivity at implementation time

The Supabase MCP tooling available during implementation was connected to the **STORE DB**,
NOT the control-plane project. Verified via `list_tables`: the reachable `public` schema
contains store tables (`products`, `orders`, `coupons`, `size_guides`, `comments`, `users`,
…) and **no** control-plane tables (`stores`, `platform_notifications`,
`notification_deliveries`, etc.).

Therefore the deny-by-default assertion was **NOT** executed live (running it against the
store DB would assert the wrong invariants — the store DB legitimately HAS RLS policies, so
the assertion would (correctly) fail there; the store DB is not deny-by-default and is not
meant to be). The assertion migration is **self-asserting and idempotent**: when applied to
the control-plane project it raises and aborts the apply if RLS is disabled on any `public`
table or if any policy exists on `public`. It must be applied to the control-plane Supabase
project (`bffnmbsjahgmvhaqyugz`), where it both documents and enforces the deny-by-default
posture. This deferral is the documented outcome of the 2.10 reconciliation step for SEC-007.
