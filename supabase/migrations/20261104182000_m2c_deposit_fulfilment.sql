-- ─── M2c C2: Deposit Fulfilment with Optional Final Payment ─────────────
-- Applies final payment and fulfilment in one atomic transaction.
-- Raises ST015 naming the exact shortfall if paid_amount <> agreed_price.
-- Sets reservation out of active state before inserting counter_sale movement (C6).

CREATE OR REPLACE FUNCTION fulfil_reservation(
  p_reservation_id uuid,
  p_actor_id uuid,
  p_final_payment numeric DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_new_paid numeric(10,2);
  v_shortfall numeric(10,2);
BEGIN
  -- 1. Lock reservation row FOR UPDATE
  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found: %', p_reservation_id USING ERRCODE = 'ST016';
  END IF;

  IF v_res.status <> 'active' THEN
    RAISE EXCEPTION 'Reservation % is already %; only active reservations can be fulfilled',
      p_reservation_id, v_res.status USING ERRCODE = 'ST017';
  END IF;

  -- 2. Apply final payment and verify full payment
  v_new_paid := v_res.paid_amount + COALESCE(p_final_payment, 0);

  IF v_new_paid <> v_res.agreed_price THEN
    v_shortfall := v_res.agreed_price - v_new_paid;
    RAISE EXCEPTION 'ST015: Shortfall of % AZN: total paid % does not equal agreed price %',
      v_shortfall, v_new_paid, v_res.agreed_price USING ERRCODE = 'ST015';
  END IF;

  -- 3. Set reservation to fulfilled BEFORE inserting movement (C6 invariant)
  UPDATE public.reservations
  SET status = 'fulfilled',
      paid_amount = v_new_paid,
      fulfilled_by = p_actor_id,
      fulfilled_at = now(),
      updated_at = now()
  WHERE id = p_reservation_id
  RETURNING * INTO v_res;

  -- 4. Insert physical inventory exit (counter_sale)
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id
  ) VALUES (
    v_res.variant_id,
    -v_res.quantity,
    'counter_sale',
    'reservation',
    p_reservation_id::text,
    p_actor_id
  );

  RETURN to_jsonb(v_res);
END;
$$;

REVOKE EXECUTE ON FUNCTION fulfil_reservation(uuid, uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION fulfil_reservation(uuid, uuid, numeric) TO authenticated, service_role;
