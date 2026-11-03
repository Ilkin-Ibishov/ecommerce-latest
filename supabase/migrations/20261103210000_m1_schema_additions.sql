-- =============================================================================
-- Migration: M1 Schema Additions That Cannot Be Backfilled
-- Timestamp: 20261103210000_m1_schema_additions.sql
-- Implements: prompts/m1-schema-additions.md (A1, A2, A3, A4)
-- Idempotent & safe for both empty and populated databases.
-- =============================================================================

-- ─── A1 & A2: Stock Movement Business Date, Grouping & Reversal Keys ─────────
-- A1: posting_date distinct from created_at, defaulting to now, settable by caller.
-- Quantity commutes under SUM; weighted average cost does not.
-- Running cost is a replayable projection ordered by business date (posting_date),
-- not insert timestamp (created_at).
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS posting_date timestamptz NOT NULL DEFAULT now();

-- Ensure any existing rows have posting_date aligned with created_at
UPDATE public.stock_movements
SET posting_date = created_at;

-- Fast index for posting_date replay and timeline queries
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_posting_date
  ON public.stock_movements(variant_id, posting_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_posting_date
  ON public.stock_movements(posting_date DESC);

-- A2: transaction_id groups movements from a single operation (counter sale, assembly, batch).
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_movements_transaction_id
  ON public.stock_movements(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- A2: correlation_id links a compensating movement to the movement it reverses.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_movements_correlation_id
  ON public.stock_movements(correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHITECTURAL DECISION NOTE FOR M2 / TRIGGER MAINTENANCE:
-- DO NOT extend trg_apply_stock_movement (the AFTER INSERT trigger) to compute cost.
-- The trigger sees insert order, not business order.
-- Cost belongs in a replay projection keyed on posting_date, which at typical shop
-- volume (hundreds of variants) executes in milliseconds.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── A3: Pack Quantity on Barcode Row ─────────────────────────────────────────
-- Outer case barcode scan vs piece scan: scanning a 12-pack case must increment by 12.
ALTER TABLE public.variant_barcodes
  ADD COLUMN IF NOT EXISTS pack_quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_quantity > 0);

ALTER TABLE public.variant_barcodes
  ADD COLUMN IF NOT EXISTS pack_unit text NOT NULL DEFAULT 'pcs';


-- ─── A4: Inventory Tracking Flag & Low Stock Threshold on Product Variants ───
-- track_stock: indicates whether physical stock is counted (false for services/made-to-order).
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- low_stock_threshold: per-variant alert threshold (accumulates data prior to M6 alerting engine).
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,3) CHECK (low_stock_threshold >= 0);
