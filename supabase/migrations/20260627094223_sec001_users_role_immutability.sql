-- ============================================================================
-- SEC-001 (P0) — public.users role immutability: all THREE defenses together
-- ----------------------------------------------------------------------------
-- Spec:    .kiro/specs/supabase-rls-security-fixes (bugfix)
-- Task:    4 (+4.1 before-reconcile, +4.2 after-reconcile)
-- Design:  Property 1 — role is immutable from the client. Apply (a)+(b)+(c).
-- Pre-flight (preflight-sec001.md, task 1): the claim mechanism is confirmed
--   live; the PRIMARY signal MUST use the empty-string-safe form
--   `nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'`
--   because a present-but-empty GUC raises 22P02 on the bare cast. The
--   SECONDARY signal `current_user in ('service_role','postgres','supabase_admin')`
--   stands (migration/dashboard connections run as `postgres`).
--
-- Live BEFORE state (reconciled task 4.1 via pg_policies / column_privileges):
--   policies: users_own_read (SELECT, auth.uid()=id)
--             users_own_update (UPDATE, auth.uid()=id, NO column restriction) <- SEC-001 hole
--   grants:   anon + authenticated hold UPDATE on ALL columns (incl. role)
--   triggers: none user-defined on public.users
-- ============================================================================

-- (a) Make public.users read-only for clients.
--     Drop the unrestricted own-row UPDATE policy (the escalation path) and
--     ensure the only client policy is a SELECT-only own-row read. We
--     drop+recreate users_own_read idempotently so the net result is exactly:
--     clients may SELECT their own row and have NO INSERT/UPDATE/DELETE policy.
--     Client writes move to the authenticated /api/profile endpoint (service role).
drop policy if exists "users_own_update" on public.users;
drop policy if exists "users_own_read" on public.users;
create policy "users_own_read"
  on public.users for select
  using (auth.uid() = id);

-- (b) Column-level privileges: role is never client-writable. Revoke the broad
--     UPDATE, then grant UPDATE only on the two profile columns. NOT role,
--     email, or phone. (Dormant while (a) leaves no UPDATE policy in place —
--     RLS denies the row-level write before column privileges are evaluated —
--     but kept as defense-in-depth in case an UPDATE policy is reintroduced.)
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
    -- Allow the change only for service-role / privileged DB roles.
    -- PRIMARY: the JWT 'role' claim from request.jwt.claims. Wrapped in
    --   nullif(..., '') so an empty-string GUC does not raise 22P02 (verified
    --   live in preflight-sec001.md); falls through cleanly to the secondary
    --   signal instead.
    -- SECONDARY: current_user — service-role PostgREST connections run as
    --   'service_role'; migrations/dashboard run as 'postgres'/'supabase_admin'.
    if coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
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
