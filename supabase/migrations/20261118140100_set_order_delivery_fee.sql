-- Mutation helper for setting delivery fee on an order (note §3).
-- Atomic update + audit_log insert; service_role only.

CREATE OR REPLACE FUNCTION public.set_order_delivery_fee(
  p_actor uuid,
  p_order uuid,
  p_fee numeric
)
RETURNS TABLE (
  old_fee numeric,
  new_fee numeric,
  total_azn numeric,
  status text
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_fee numeric;
  v_old_total numeric;
  v_status public.order_status;
  v_new_total numeric;
BEGIN
  SELECT o.delivery_fee_azn, o.total_azn, o.status
  INTO v_old_fee, v_old_total, v_status
  FROM public.orders AS o
  WHERE o.id = p_order
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'ST050';
  END IF;

  IF v_status IN ('delivered', 'cancelled', 'refused_at_delivery') THEN
    RAISE EXCEPTION 'Order status closed for fee modification' USING ERRCODE = 'ST051';
  END IF;

  IF v_old_fee IS NOT NULL AND v_old_fee = p_fee THEN
    old_fee := v_old_fee;
    new_fee := p_fee;
    total_azn := v_old_total;
    status := v_status::text;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.orders AS o
  SET delivery_fee_azn = p_fee
  WHERE o.id = p_order
  RETURNING o.total_azn INTO v_new_total;

  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, changes)
  VALUES (
    p_actor,
    'set_delivery_fee',
    'order',
    p_order,
    jsonb_build_object(
      'old_fee', v_old_fee,
      'new_fee', p_fee,
      'old_total', v_old_total,
      'new_total', v_new_total
    )
  );

  old_fee := v_old_fee;
  new_fee := p_fee;
  total_azn := v_new_total;
  status := v_status::text;
  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_delivery_fee(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_delivery_fee(uuid, uuid, numeric) TO service_role;
