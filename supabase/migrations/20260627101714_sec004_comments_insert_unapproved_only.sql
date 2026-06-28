-- SEC-004 (P1) — Constrain authenticated comment inserts to approved = false.
--
-- Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
-- Task:    13 — Fix SEC-004 (Property 4).
-- Finding: The own-insert policy validated ownership only
--          (with check (user_id = auth.uid())) and did NOT constrain the
--          `approved` column, so an authenticated client could self-publish a
--          review with approved = true, bypassing moderation.
-- Fix:     Recreate the own-insert policy so a self-insert can only land
--          unapproved (auth.uid() = user_id AND approved = false). Moderation
--          (flipping approved = true) stays a service-role / admin operation.
--
-- Live reconciliation (2.10): the live insert policy is named
-- `comments_own_insert` (INSERT, with check (user_id = auth.uid())). The public
-- read policy (`comments_public_read`) and the admin policy
-- (`comments_admin_update`) are RETAINED and untouched here.

drop policy if exists "comments_own_insert" on public.comments;

create policy "comments_own_insert"
  on public.comments for insert
  with check (auth.uid() = user_id and approved = false);

-- retained: "comments_public_read"  (select using approved = true OR own OR admin)
-- retained: "comments_admin_update" (admin moderation via service role)
