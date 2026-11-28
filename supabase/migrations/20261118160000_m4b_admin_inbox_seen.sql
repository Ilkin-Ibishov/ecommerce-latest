CREATE TABLE public.admin_inbox_seen (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL
);
ALTER TABLE public.admin_inbox_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AdminInboxSeen: service role" ON public.admin_inbox_seen
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.admin_inbox_seen FROM public, anon, authenticated;
GRANT ALL ON public.admin_inbox_seen TO service_role;
