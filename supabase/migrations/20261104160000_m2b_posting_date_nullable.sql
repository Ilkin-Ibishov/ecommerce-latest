-- =============================================================================
-- Migration: M2b Nullable Stocktake Posting Date & Deferred Posting Timestamp
-- Timestamp: 20261104160000_m2b_posting_date_nullable.sql
-- Description:
--   1. Drop default and NOT NULL constraint on public.stocktakes.posting_date.
--   2. Redefine post_stocktake to use COALESCE(v_st.posting_date, now()),
--      enforce ST010 observation guard only when posting_date was explicitly set,
--      write movements with v_effective_posting, and record v_effective_posting
--      back onto stocktakes.posting_date on post.
-- Note: Redefines post_stocktake in full (~240 lines) to maintain PL/pgSQL function atomicity.
-- =============================================================================

-- ─── 1. Make stocktakes.posting_date Nullable without Default ────────────────
ALTER TABLE public.stocktakes ALTER COLUMN posting_date DROP DEFAULT;
ALTER TABLE public.stocktakes ALTER COLUMN posting_date DROP NOT NULL;

DROP POLICY IF EXISTS "Stocktakes: staff draft update" ON public.stocktakes;
CREATE POLICY "Stocktakes: staff draft update" ON public.stocktakes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND status = 'draft'
  )
  WITH CHECK (
    status = 'draft'
    AND is_opening_count = false
    AND posted_by IS NULL
    AND posted_at IS NULL
    AND transaction_id IS NULL
    AND posting_date IS NOT DISTINCT FROM (SELECT s.posting_date FROM public.stocktakes s WHERE s.id = stocktakes.id)
  );

-- ─── 2. Update Atomic Stocktake Posting RPC ──────────────────────────────────
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
  v_missing_snap_variant uuid;
  v_override_no_line_variant uuid;
  v_stale_variant uuid;
  v_effective_posting timestamptz;
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

  v_effective_posting := COALESCE(v_st.posting_date, now());

  -- 3. R2 Guard: posting_date cannot be earlier than any contributing line snapshot
  -- Evaluated only when an explicit business posting_date was supplied by owner
  IF v_st.posting_date IS NOT NULL AND EXISTS (
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

  -- 4b. Guard: Verify resolutions are not stale (A4)
  SELECT sr.variant_id INTO v_stale_variant
  FROM public.stocktake_resolutions sr
  LEFT JOIN (
    SELECT
      variant_id,
      COUNT(*) AS current_line_count,
      MAX(created_at) AS current_latest_line_at
    FROM public.stocktake_lines
    WHERE stocktake_id = p_stocktake_id
    GROUP BY variant_id
  ) cur ON cur.variant_id = sr.variant_id
  WHERE sr.stocktake_id = p_stocktake_id
    AND (
      COALESCE(cur.current_line_count, 0) <> sr.resolved_line_count
      OR cur.current_latest_line_at > sr.resolved_latest_line_at
    )
  LIMIT 1;

  IF v_stale_variant IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot post stocktake %: resolution for variant % is stale - lines changed after it was recorded',
      p_stocktake_id, v_stale_variant USING ERRCODE = 'ST011';
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

  -- 5b. Guard: override resolution must specify chosen_line_id (F2)
  SELECT sr.variant_id INTO v_override_no_line_variant
  FROM public.stocktake_resolutions sr
  WHERE sr.stocktake_id = p_stocktake_id
    AND sr.resolution_type = 'override'
    AND sr.chosen_line_id IS NULL
  LIMIT 1;

  IF v_override_no_line_variant IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot post stocktake %: variant % has override resolution with no chosen line',
      p_stocktake_id, v_override_no_line_variant USING ERRCODE = 'ST013';
  END IF;

  -- 6. Atomically compute reconciled count & snapshot delta (R5, F2)
  -- Pre-flight check: verify every reconciled variant has an authoritative system snapshot
  SELECT vs.variant_id INTO v_missing_snap_variant
  FROM (
    SELECT DISTINCT variant_id
    FROM public.stocktake_lines
    WHERE stocktake_id = p_stocktake_id
  ) vs
  LEFT JOIN public.stocktake_resolutions sr
    ON sr.stocktake_id = p_stocktake_id AND sr.variant_id = vs.variant_id
  LEFT JOIN LATERAL (
    SELECT stls.snapshot_on_hand
    FROM public.stocktake_line_snapshots stls
    WHERE stls.line_id = sr.chosen_line_id
  ) override_snap ON sr.resolution_type = 'override'
  LEFT JOIN LATERAL (
    SELECT stls.snapshot_on_hand
    FROM public.stocktake_lines stl
    JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
    WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
    ORDER BY stl.created_at DESC
    LIMIT 1
  ) latest_snap ON (sr.resolution_type IS NULL OR sr.resolution_type <> 'override')
  WHERE CASE
    WHEN sr.resolution_type = 'override' THEN override_snap.snapshot_on_hand
    ELSE latest_snap.snapshot_on_hand
  END IS NULL
  LIMIT 1;

  IF v_missing_snap_variant IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot post stocktake %: variant % has count lines with no system snapshot',
      p_stocktake_id, v_missing_snap_variant USING ERRCODE = 'ST010';
  END IF;

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
      CASE
        WHEN sr.resolution_type = 'override' THEN override_snap.snapshot_on_hand
        ELSE latest_snap.snapshot_on_hand
      END AS effective_snapshot
    FROM variant_scans vs
    LEFT JOIN public.stocktake_resolutions sr 
      ON sr.stocktake_id = p_stocktake_id AND sr.variant_id = vs.variant_id
    LEFT JOIN LATERAL (
      SELECT stls.snapshot_on_hand
      FROM public.stocktake_line_snapshots stls
      WHERE stls.line_id = sr.chosen_line_id
    ) override_snap ON sr.resolution_type = 'override'
    LEFT JOIN LATERAL (
      SELECT stls.snapshot_on_hand
      FROM public.stocktake_lines stl
      JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
      WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
      ORDER BY stl.created_at DESC
      LIMIT 1
    ) latest_snap ON (sr.resolution_type IS NULL OR sr.resolution_type <> 'override')
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
    v_effective_posting,
    v_tx_id
  FROM variant_deltas vd
  WHERE vd.delta <> 0; -- Ledger forbids zero delta

  -- 7. Scoped cost recomputation for affected variants
  FOR v_var IN (
    SELECT DISTINCT variant_id 
    FROM public.stocktake_lines 
    WHERE stocktake_id = p_stocktake_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_effective_posting);
  END LOOP;

  -- 8. Mark stocktake posted and record effective posting date
  UPDATE public.stocktakes
  SET status = 'posted',
      posting_date = v_effective_posting,
      transaction_id = v_tx_id,
      posted_by = p_actor_id,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_stocktake_id;
END;
$$;

-- ─── 3. Privileges Configuration ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.post_stocktake(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stocktake(uuid, uuid) TO service_role;
