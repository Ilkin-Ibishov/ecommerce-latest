-- SEC-002 (P1) — Drop the world-write policy on public.size_guides.
--
-- Spec:    .kiro/specs/supabase-rls-security-fixes (bugfix)
-- Task:    11 — Property 2.
-- Finding: "size_guides_admin_write" was FOR ALL using(true) with check(true),
--          granting anon/authenticated full INSERT/UPDATE/DELETE through the
--          anon client (a "service role only" comment that the policy did not
--          actually enforce). Confirmed live: roles={public}, qual=true,
--          with_check=true.
--
-- Fix:     Remove the client-write policy entirely. Admin size-guide writes flow
--          through the service role (artifacts/api-server/src/routes/size-guides.ts),
--          which bypasses RLS and needs no policy. The public read policy
--          ("size_guides_read", FOR SELECT using(true)) is RETAINED so shoppers
--          can still read size guides [Preservation 3.2].
--
-- Requirements: 2.2, 2.10, 3.2

drop policy if exists "size_guides_admin_write" on public.size_guides;

-- RETAINED (do NOT drop): "size_guides_read" ON public.size_guides FOR SELECT USING (true)
