-- =============================================================================
-- Migration: M2a Historical Cost Replay Backfill
-- Timestamp: 20261104120000_m2a_cost_backfill.sql
-- Description:
--   Populates stock_movement_costs for all pre-existing historical movements
--   by executing recompute_variant_cost once per distinct variant.
-- =============================================================================

DO $$
DECLARE
  v_var record;
BEGIN
  FOR v_var IN (
    SELECT DISTINCT variant_id
    FROM public.stock_movements
    ORDER BY variant_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, NULL);
  END LOOP;
END $$;
