-- Hardens trg_users_keep_one_admin (20261118120100) after the staff-provisioning adversarial audit.
--
-- 1. The advisory-lock-then-count guard is race-free only under READ COMMITTED, where the count
--    after the lock takes a fresh snapshot. Under REPEATABLE READ / SERIALIZABLE the count reads the
--    transaction's old snapshot, so two concurrent demotions could both pass. PostgREST (and so every
--    route) runs READ COMMITTED; any other writer that demotes or deletes an admin under another
--    level is refused (ST042) instead of being trusted.
-- 2. Row triggers do not fire on TRUNCATE; a statement trigger refuses it (ST040).

CREATE OR REPLACE FUNCTION public.ensure_an_admin_remains()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Admin role changes require READ COMMITTED isolation' USING ERRCODE = 'ST042';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('public.users.admin_count'));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = 'ST040';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_users_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'public.users cannot be truncated: at least one admin must remain' USING ERRCODE = 'ST040';
END;
$$;

CREATE TRIGGER trg_users_refuse_truncate
  BEFORE TRUNCATE ON public.users
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refuse_users_truncate();
