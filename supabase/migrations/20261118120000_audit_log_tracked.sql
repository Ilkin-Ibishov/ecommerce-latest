-- Tracked DDL for public.audit_log (A2 amendment, design note §12).
-- audit_log exists on the live/test project but previously had no tracked migration.
-- Policy "audit_admin_read" is already created by 20260627111906_sec005_is_admin_helper_and_policies.sql.

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
