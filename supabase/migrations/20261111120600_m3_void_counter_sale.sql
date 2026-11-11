-- Migration: void_counter_sale — the owner cancels a counter sale (design note Q2, Q5).
-- A posted sale gets one compensating movement per original movement, at the original
-- posting_date, so units, revenue and cost net to zero for that day. A needs_owner sale has
-- no movements and only changes status. Nothing is edited or deleted in the ledger.
-- Owner-only: Express checks the role.

CREATE OR REPLACE FUNCTION public.void_counter_sale(
  p_id uuid,
  p_reason text,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
  v_posting timestamptz;
  v_var record;
BEGIN
  IF p_reason IS NULL OR char_length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A void needs a reason' USING ERRCODE = 'ST026';
  END IF;

  SELECT status, posting_date INTO v_status, v_posting
  FROM public.counter_sales WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Counter sale not found: %', p_id USING ERRCODE = 'ST016';
  END IF;
  IF v_status = 'voided' THEN
    RAISE EXCEPTION 'Counter sale % is already voided', p_id USING ERRCODE = 'ST022';
  END IF;

  IF v_status = 'posted' THEN
    PERFORM 1 FROM public.product_variants pv
    WHERE pv.id IN (SELECT variant_id FROM public.counter_sale_lines WHERE sale_id = p_id)
    ORDER BY pv.id
    FOR UPDATE;

    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id,
      correlation_id, posting_date, actor_id, note
    )
    SELECT sm.variant_id, -sm.quantity_delta, 'counter_sale', 'counter_sale', sm.reference_id,
           sm.transaction_id, sm.id, sm.posting_date, p_session_user, 'void'
    FROM public.stock_movements sm
    WHERE sm.transaction_id = p_id AND sm.reference_type = 'counter_sale' AND sm.quantity_delta < 0
    ORDER BY sm.created_at, sm.id;

    FOR v_var IN SELECT DISTINCT variant_id FROM public.counter_sale_lines WHERE sale_id = p_id ORDER BY 1 LOOP
      PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
    END LOOP;

    UPDATE public.counter_sale_lines l
    SET posted_after_count = EXISTS (
      SELECT 1 FROM public.stocktake_line_snapshots s
      JOIN public.stocktake_lines sl ON sl.id = s.line_id
      JOIN public.stocktakes st ON st.id = sl.stocktake_id AND st.status <> 'cancelled'
      WHERE sl.variant_id = l.variant_id AND s.captured_at > v_posting)
    WHERE l.sale_id = p_id;
  END IF;

  UPDATE public.counter_sales
  SET status = 'voided', voided_by = p_session_user, voided_at = now(), void_reason = trim(p_reason)
  WHERE id = p_id;

  RETURN public.counter_sale_json(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_counter_sale(uuid, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_counter_sale(uuid, text, uuid) TO service_role;
