-- Migration: post_counter_sale — one transaction for header, lines and movements
-- (M3 spec §6, design note Q2). Express prices the sale with lib/counter-pricing and passes
-- per-line net totals; this function locks, checks the sums, computes every flag from
-- locked rows, and posts. If the on-hand guard refuses (ST001), the sale is stored as
-- needs_owner with no movements: the till never loses a paid sale (spec §4).

-- Shared result shape for the three counter functions.
CREATE OR REPLACE FUNCTION public.counter_sale_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', cs.id,
    'sale_number', cs.sale_number,
    'status', cs.status,
    'needs_owner_reason', cs.needs_owner_reason,
    'total_amount', cs.total_amount,
    'total_mismatch', cs.total_mismatch,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_no', l.line_no,
        'price_mismatch', l.price_mismatch,
        'reservation_override', l.reservation_override,
        'posted_after_count', l.posted_after_count) ORDER BY l.line_no)
      FROM public.counter_sale_lines l WHERE l.sale_id = cs.id), '[]'::jsonb))
  FROM public.counter_sales cs WHERE cs.id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.counter_sale_json(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.counter_sale_json(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.post_counter_sale(
  p_sale jsonb,
  p_payload_hash text,
  p_session_user uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid := (p_sale->>'id')::uuid;
  v_existing_hash text;
  v_posting timestamptz := now();
  v_total numeric(12,2) := (p_sale->>'total_amount')::numeric;
  v_inserted integer;
  v_wanted integer;
  v_locked integer;
  v_var record;
BEGIN
  -- 1. Idempotency: same id + same hash = replay; same id + other hash = a bug.
  SELECT payload_hash INTO v_existing_hash FROM public.counter_sales WHERE id = v_id;
  IF FOUND THEN
    IF v_existing_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'Counter sale % already exists with a different payload', v_id USING ERRCODE = 'ST020';
    END IF;
    RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', true);
  END IF;

  IF jsonb_array_length(COALESCE(p_sale->'lines', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A counter sale needs at least one line' USING ERRCODE = 'ST024';
  END IF;

  -- 2. Lock every variant once, ascending id (same order as decrement_order_stock).
  SELECT count(DISTINCT (l->>'variant_id')::uuid) INTO v_wanted
  FROM jsonb_array_elements(p_sale->'lines') l;

  WITH locked AS (
    SELECT pv.id FROM public.product_variants pv
    WHERE pv.id IN (SELECT (l->>'variant_id')::uuid FROM jsonb_array_elements(p_sale->'lines') l)
    ORDER BY pv.id
    FOR UPDATE
  )
  SELECT count(*) INTO v_locked FROM locked;

  IF v_locked <> v_wanted THEN
    RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'ST002';
  END IF;

  -- 3. The priced sale must add up (Express prices it; a mismatch is an Express bug).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale->'lines') l WHERE (l->>'net_line_total')::numeric < 0)
     OR (SELECT sum((l->>'net_line_total')::numeric) FROM jsonb_array_elements(p_sale->'lines') l) <> v_total THEN
    RAISE EXCEPTION 'Line totals do not sum to the sale total %', v_total USING ERRCODE = 'ST023';
  END IF;

  -- 4. Header. ON CONFLICT covers a concurrent identical request that won the race.
  INSERT INTO public.counter_sales (
    id, payload_hash, sold_at, posting_date, payment_method, bundle_discount, owner_discount,
    total_amount, displayed_total, total_mismatch, note, cashier_id, posted_by, status
  ) VALUES (
    v_id, p_payload_hash, (p_sale->>'sold_at')::timestamptz, v_posting, p_sale->>'payment_method',
    COALESCE((p_sale->>'bundle_discount')::numeric, 0), COALESCE((p_sale->>'owner_discount')::numeric, 0),
    v_total, (p_sale->>'displayed_total')::numeric, (p_sale->>'displayed_total')::numeric <> v_total,
    NULLIF(trim(p_sale->>'note'), ''), p_session_user, p_session_user, 'posted'
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT payload_hash INTO v_existing_hash FROM public.counter_sales WHERE id = v_id;
    IF v_existing_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'Counter sale % already exists with a different payload', v_id USING ERRCODE = 'ST020';
    END IF;
    RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', true);
  END IF;

  -- 5. Lines, with every flag computed here from the locked rows.
  INSERT INTO public.counter_sale_lines (
    sale_id, line_no, variant_id, quantity, list_unit_price, charged_unit_price, bundle_id,
    net_line_total, price_mismatch, reservation_override
  )
  SELECT
    v_id, l.line_no, l.variant_id, l.quantity, pv.price, l.charged_unit_price, l.bundle_id,
    l.net_line_total,
    l.charged_unit_price <> pv.price,
    COALESCE(r.reserved, 0) > 0 AND pv.on_hand - COALESCE(r.reserved, 0) - s.sale_qty < 0
  FROM jsonb_to_recordset(p_sale->'lines') AS l(
    line_no integer, variant_id uuid, quantity integer, charged_unit_price numeric,
    bundle_id uuid, net_line_total numeric)
  JOIN public.product_variants pv ON pv.id = l.variant_id
  JOIN (
    SELECT (x->>'variant_id')::uuid AS variant_id, sum((x->>'quantity')::integer) AS sale_qty
    FROM jsonb_array_elements(p_sale->'lines') x GROUP BY 1
  ) s ON s.variant_id = l.variant_id
  LEFT JOIN (
    SELECT variant_id, sum(quantity) AS reserved FROM public.reservations
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
    GROUP BY variant_id
  ) r ON r.variant_id = l.variant_id;

  -- 6. Movements and cost replay, inside a savepoint. ST001 (on-hand guard) keeps the
  --    sale as needs_owner with no movements.
  BEGIN
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, reference_id, transaction_id, posting_date, actor_id
    )
    SELECT variant_id, -quantity, 'counter_sale', 'counter_sale', v_id::text, v_id, v_posting, p_session_user
    FROM public.counter_sale_lines WHERE sale_id = v_id ORDER BY line_no;

    FOR v_var IN SELECT DISTINCT variant_id FROM public.counter_sale_lines WHERE sale_id = v_id ORDER BY 1 LOOP
      PERFORM public.recompute_variant_cost(v_var.variant_id, v_posting);
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'ST001' THEN
    UPDATE public.counter_sales SET status = 'needs_owner', needs_owner_reason = 'on_hand' WHERE id = v_id;
  END;

  RETURN public.counter_sale_json(v_id) || jsonb_build_object('replayed', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) TO service_role;
