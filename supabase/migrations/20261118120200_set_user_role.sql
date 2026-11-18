-- Role mutation helper and auth user phone lookup (spec §3, design note §3).
-- set_user_role: atomic update + audit_log insert; service_role only.
-- find_auth_user_by_phone: lookup auth.users by normalized digits; service_role only.

CREATE OR REPLACE FUNCTION public.set_user_role(
  p_actor uuid,
  p_user uuid,
  p_role text
) RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_role text;
BEGIN
  SELECT role INTO v_old_role
  FROM public.users
  WHERE id = p_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ST041';
  END IF;

  IF v_old_role = p_role THEN
    RETURN v_old_role;
  END IF;

  UPDATE public.users
  SET role = p_role
  WHERE id = p_user;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, changes)
  VALUES (
    p_actor,
    'change_user_role',
    'user',
    p_user,
    jsonb_build_object('old_role', v_old_role, 'new_role', p_role)
  );

  RETURN v_old_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_auth_user_by_phone(
  p_phone text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.find_auth_user_by_phone(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_phone(text) TO service_role;
