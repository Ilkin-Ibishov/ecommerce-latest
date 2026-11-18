-- Ensure at least one admin remains in public.users (spec §5, design note §2).
-- Interleaving-safe via transaction-scoped advisory lock + post-lock admin existence check.

CREATE OR REPLACE FUNCTION public.ensure_an_admin_remains()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.users.admin_count'));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = 'ST040';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_keep_one_admin ON public.users;
CREATE TRIGGER trg_users_keep_one_admin
  AFTER UPDATE OF role OR DELETE ON public.users
  FOR EACH ROW
  WHEN (OLD.role = 'admin')
  EXECUTE FUNCTION public.ensure_an_admin_remains();
