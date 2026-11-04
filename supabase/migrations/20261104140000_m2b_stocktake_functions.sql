-- =============================================================================
-- Migration: M2b Stocktake Snapshot Trigger & Posting RPC
-- Timestamp: 20261104140000_m2b_stocktake_functions.sql
-- Description:
--   1. trg_capture_stocktake_line_snapshot: Captures authoritative on-hand snapshot AFTER INSERT
--   2. post_stocktake: Atomically reconciles counts against latest snapshots, writes movements, recomputes costs
--   (Note: variance review dataset computation is performed in TypeScript via artifacts/api-server/src/lib/stocktake-variance.ts)
-- =============================================================================

-- ─── 1. Snapshot Capture Trigger Function ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_capture_stocktake_line_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_on_hand numeric(12,3);
BEGIN
  -- Authoritative system on-hand read at the microsecond of line creation
  SELECT COALESCE(on_hand, 0) INTO v_current_on_hand
  FROM public.product_variants
  WHERE id = NEW.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', NEW.variant_id USING ERRCODE = 'ST002';
  END IF;

  INSERT INTO public.stocktake_line_snapshots (
    line_id,
    snapshot_on_hand,
    captured_at
  ) VALUES (
    NEW.id,
    v_current_on_hand,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stocktake_lines_capture_snapshot ON public.stocktake_lines;
CREATE TRIGGER trg_stocktake_lines_capture_snapshot
  AFTER INSERT ON public.stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_stocktake_line_snapshot();


-- ─── 2. Atomic Stocktake Posting RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_stocktake(
  p_stocktake_id uuid,
  p_actor_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_st record;
  v_tx_id uuid := gen_random_uuid();
  v_var record;
  v_unresolved_count integer;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Actor ID is required for stocktake posting' USING ERRCODE = 'ST007';
  END IF;

  -- 1. Exclusively lock the stocktake header row
  SELECT * INTO v_st
  FROM public.stocktakes
  WHERE id = p_stocktake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stocktake not found: %', p_stocktake_id USING ERRCODE = 'P0002';
  END IF;

  IF v_st.status <> 'draft' THEN
    RAISE EXCEPTION 'Stocktake % is already % and cannot be posted', p_stocktake_id, v_st.status
      USING ERRCODE = 'ST003';
  END IF;

  -- 2. Verify lines exist
  IF NOT EXISTS (SELECT 1 FROM public.stocktake_lines WHERE stocktake_id = p_stocktake_id) THEN
    RAISE EXCEPTION 'Cannot post stocktake %: no lines have been entered', p_stocktake_id
      USING ERRCODE = 'ST004';
  END IF;

  -- 3. R2 Guard: posting_date cannot be earlier than any contributing line snapshot
  IF EXISTS (
    SELECT 1 FROM public.stocktake_lines stl
    JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
    WHERE stl.stocktake_id = p_stocktake_id
      AND v_st.posting_date < stls.captured_at
  ) THEN
    RAISE EXCEPTION 'Stocktake posting_date (%) cannot be earlier than contributing line observations',
      v_st.posting_date USING ERRCODE = 'ST010';
  END IF;

  -- 4. R3 Guard: Verify multi-counter duplicates without distinct locations are resolved
  WITH variant_scans AS (
    SELECT
      variant_id,
      COUNT(*) AS total_scans,
      COUNT(location_note) AS non_null_locations,
      COUNT(DISTINCT NULLIF(TRIM(location_note), '')) AS distinct_locations
    FROM public.stocktake_lines
    WHERE stocktake_id = p_stocktake_id
    GROUP BY variant_id
    HAVING COUNT(*) > 1
  ),
  unresolved_suspicious AS (
    SELECT vs.variant_id
    FROM variant_scans vs
    LEFT JOIN public.stocktake_resolutions sr 
      ON sr.stocktake_id = p_stocktake_id AND sr.variant_id = vs.variant_id
    WHERE sr.variant_id IS NULL
      AND (vs.total_scans <> vs.non_null_locations OR vs.total_scans <> vs.distinct_locations)
  )
  SELECT COUNT(*) INTO v_unresolved_count FROM unresolved_suspicious;

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'Cannot post stocktake %: % variants have conflicting scans requiring resolution',
      p_stocktake_id, v_unresolved_count USING ERRCODE = 'ST009';
  END IF;

  -- 5. If opening count, apply entered opening costs to variant_costs carrier
  IF v_st.is_opening_count THEN
    INSERT INTO public.variant_costs (variant_id, opening_cost, cost_price, updated_at)
    SELECT soc.variant_id, soc.opening_unit_cost, soc.opening_unit_cost, now()
    FROM public.stocktake_opening_costs soc
    WHERE soc.stocktake_id = p_stocktake_id
    ON CONFLICT (variant_id) DO UPDATE SET
      opening_cost = EXCLUDED.opening_cost,
      cost_price = EXCLUDED.opening_cost,
      updated_at = now();
  END IF;

  -- 6. Atomically compute reconciled count & latest snapshot delta (R5)
  WITH variant_scans AS (
    SELECT
      stl.variant_id,
      COUNT(*) AS scan_count,
      SUM(stl.counted_quantity) AS sum_counted
    FROM public.stocktake_lines stl
    WHERE stl.stocktake_id = p_stocktake_id
    GROUP BY stl.variant_id
  ),
  reconciled AS (
    SELECT
      vs.variant_id,
      CASE
        WHEN sr.resolution_type = 'override' THEN sr.resolved_quantity
        WHEN sr.resolution_type = 'sum' THEN sr.resolved_quantity
        ELSE vs.sum_counted
      END AS effective_counted,
      latest_snap.snapshot_on_hand AS effective_snapshot
    FROM variant_scans vs
    LEFT JOIN public.stocktake_resolutions sr 
      ON sr.stocktake_id = p_stocktake_id AND sr.variant_id = vs.variant_id
    CROSS JOIN LATERAL (
      SELECT stls.snapshot_on_hand
      FROM public.stocktake_lines stl
      JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
      WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
      ORDER BY stl.created_at DESC
      LIMIT 1
    ) latest_snap
  ),
  variant_deltas AS (
    SELECT
      variant_id,
      (effective_counted - effective_snapshot) AS delta
    FROM reconciled
  )
  -- An opening_balance movement may be negative, because an opening count establishes
  -- the true quantity over a migrated placeholder, and the sum of a variant's opening_balance
  -- movements is its established opening quantity.
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id,
    note,
    posting_date,
    transaction_id
  )
  SELECT
    vd.variant_id,
    vd.delta,
    CASE 
      WHEN v_st.is_opening_count THEN 'opening_balance'::stock_movement_reason
      ELSE 'stocktake_correction'::stock_movement_reason
    END,
    'stocktake',
    v_st.id::text,
    p_actor_id,
    CASE
      WHEN v_st.is_opening_count THEN 'Opening count: ' || v_st.stocktake_number
      ELSE 'Stocktake correction: ' || v_st.stocktake_number
    END,
    v_st.posting_date,
    v_tx_id
  FROM variant_deltas vd
  WHERE vd.delta <> 0; -- Ledger forbids zero delta

  -- 7. Scoped cost recomputation for affected variants
  FOR v_var IN (
    SELECT DISTINCT variant_id 
    FROM public.stocktake_lines 
    WHERE stocktake_id = p_stocktake_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_st.posting_date);
  END LOOP;

  -- 8. Mark stocktake posted
  UPDATE public.stocktakes
  SET status = 'posted',
      transaction_id = v_tx_id,
      posted_by = p_actor_id,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_stocktake_id;
END;
$$;


-- ─── 3. Privileges Configuration ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.trg_capture_stocktake_line_snapshot() FROM public;
GRANT EXECUTE ON FUNCTION public.trg_capture_stocktake_line_snapshot() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.post_stocktake(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stocktake(uuid, uuid) TO service_role;
