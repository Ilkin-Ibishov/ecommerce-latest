-- Recreate comments SELECT policy to allow users to read back their own comments (including unapproved) and admins to read all comments.
-- Reconciles schema drift noted in 20260627101714_sec004_comments_insert_unapproved_only.sql.

drop policy if exists "Comments: public read approved" on public.comments;
drop policy if exists "comments_public_read" on public.comments;

create policy "comments_public_read" on public.comments for select using (
  approved = true
  or user_id = auth.uid()
  or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
