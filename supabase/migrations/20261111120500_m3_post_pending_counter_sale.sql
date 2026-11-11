-- Migration: post_pending_counter_sale — the owner posts a needs_owner sale after fixing
-- stock (design note Q2). Movements go in at the sale's original posting_date; if stock is
-- still short, ST001 reaches the owner. Lines are flagged posted_after_count when a count
-- snapshotted the variant after that date (Q7). Owner-only: Express checks the role.

CREATE OR REPLACE FUNCTION public.post_pending_counter_sale(
  p_id uuid,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
  v_posting timestamptz;
  v_var record;
BEGIN
  SELECT status, posting_date INTO v_status, v_posting
  FROM public.counter_sales WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Counter sale not found: %', p_id USING ERRCODE = 'ST016';
  END IF;
  IF v_status <> 'needs_owner' THEN
    RAISE EXCEPTION 'Counter sale % is %; only needs_owner sales can be posted', p_id, v_status
      USING ERRCODE = 'ST025';
  END IF;

  -- Same lock order as post_counter_sale.
  PERFORM 1 FROM public.product_variants pv
  WHERE pv.id IN (SELECT variant_id FROM public.counter_sale_lines WHERE sale_id = p_id)
  ORDER BY pv.id
  FOR UPDATE;

  INSERT INTO public.stock_movements (
    variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id, posting_date, actor_id
  )
  SELECT variant_id, -quantity, 'counter_sale', 'counter_sale', p_id::text, p_id, v_posting, p_session_user
  FROM public.counter_sale_lines WHERE sale_id = p_id ORDER BY line_no;

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

  UPDATE public.counter_sales
  SET status = 'posted', resolved_by = p_session_user, resolved_at = now()
  WHERE id = p_id;

  RETURN public.counter_sale_json(p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_pending_counter_sale(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_pending_counter_sale(uuid, uuid) TO service_role;
