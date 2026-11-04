-- =============================================================================
-- Migration: M2b Stocktake Schema Tables & RLS Policies
-- Timestamp: 20261104130000_m2b_stocktake_tables.sql
-- Description:
--   1. Creates stocktakes header table with status, opening count flag, and posting date
--   2. Enforces unique partial index: at most one posted opening count per tenant
--   3. Creates stocktake_lines table (quantities, counter attribution, location note)
--   4. Creates isolated admin-only stocktake_line_snapshots table for blind counting
--   5. Creates isolated admin-only stocktake_opening_costs carrier table
--   6. Creates isolated admin-only stocktake_resolutions conflict resolution table
--   7. Configures strict RLS protecting snapshot and cost data from staff tokens
-- =============================================================================

-- ─── 1. Stocktakes Header Table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stocktakes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_number  text UNIQUE NOT NULL,
  title             text NOT NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  is_opening_count  boolean NOT NULL DEFAULT false,
  posting_date      timestamptz NOT NULL DEFAULT now(),
  transaction_id    uuid,
  created_by        uuid REFERENCES public.users(id),
  posted_by         uuid REFERENCES public.users(id),
  posted_at         timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stocktakes_status ON public.stocktakes(status);
CREATE INDEX IF NOT EXISTS idx_stocktakes_created ON public.stocktakes(created_at DESC);

-- Invariant: At most one posted opening count in tenant history
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_posted_opening_stocktake
  ON public.stocktakes (is_opening_count)
  WHERE (is_opening_count = true AND status = 'posted');

ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktakes' AND policyname = 'Stocktakes: staff/admin read') THEN
    CREATE POLICY "Stocktakes: staff/admin read" ON public.stocktakes
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktakes' AND policyname = 'Stocktakes: staff draft insert') THEN
    CREATE POLICY "Stocktakes: staff draft insert" ON public.stocktakes
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND status = 'draft'
        AND is_opening_count = false
        AND posted_by IS NULL
        AND posted_at IS NULL
        AND transaction_id IS NULL
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktakes' AND policyname = 'Stocktakes: staff draft update') THEN
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
        AND posting_date = (SELECT s.posting_date FROM public.stocktakes s WHERE s.id = stocktakes.id)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktakes' AND policyname = 'Stocktakes: admin all') THEN
    CREATE POLICY "Stocktakes: admin all" ON public.stocktakes
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 2. Stocktake Lines Table (Quantities & Attribution Only) ────────────────
CREATE TABLE IF NOT EXISTS public.stocktake_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id      uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  counter_id        uuid NOT NULL REFERENCES public.users(id),
  counted_quantity  numeric(12,3) NOT NULL CHECK (counted_quantity >= 0),
  location_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_stocktake ON public.stocktake_lines(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_variant ON public.stocktake_lines(variant_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_counter ON public.stocktake_lines(counter_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_composite ON public.stocktake_lines(stocktake_id, variant_id);

ALTER TABLE public.stocktake_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_lines' AND policyname = 'StocktakeLines: staff/admin read') THEN
    CREATE POLICY "StocktakeLines: staff/admin read" ON public.stocktake_lines
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_lines' AND policyname = 'StocktakeLines: staff draft insert') THEN
    CREATE POLICY "StocktakeLines: staff draft insert" ON public.stocktake_lines
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND counter_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.stocktakes st WHERE st.id = stocktake_id AND st.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_lines' AND policyname = 'StocktakeLines: staff draft update own') THEN
    CREATE POLICY "StocktakeLines: staff draft update own" ON public.stocktake_lines
      FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND counter_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.stocktakes st WHERE st.id = stocktake_id AND st.status = 'draft')
      )
      WITH CHECK (
        counter_id = auth.uid()
        AND counted_quantity >= 0
        AND EXISTS (SELECT 1 FROM public.stocktakes st WHERE st.id = stocktake_id AND st.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_lines' AND policyname = 'StocktakeLines: staff draft delete own') THEN
    CREATE POLICY "StocktakeLines: staff draft delete own" ON public.stocktake_lines
      FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND counter_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.stocktakes st WHERE st.id = stocktake_id AND st.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_lines' AND policyname = 'StocktakeLines: admin all') THEN
    CREATE POLICY "StocktakeLines: admin all" ON public.stocktake_lines
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 3. Stocktake Line Snapshots (Admin-Only RLS) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.stocktake_line_snapshots (
  line_id           uuid PRIMARY KEY REFERENCES public.stocktake_lines(id) ON DELETE CASCADE,
  snapshot_on_hand  numeric(12,3) NOT NULL,
  captured_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stocktake_line_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_line_snapshots' AND policyname = 'LineSnapshots: admin only') THEN
    CREATE POLICY "LineSnapshots: admin only" ON public.stocktake_line_snapshots
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 4. Stocktake Opening Costs Carrier (Admin-Only RLS) ─────────────────────
CREATE TABLE IF NOT EXISTS public.stocktake_opening_costs (
  stocktake_id      uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  opening_unit_cost numeric(10,2) NOT NULL CHECK (opening_unit_cost >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stocktake_id, variant_id)
);

ALTER TABLE public.stocktake_opening_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_opening_costs' AND policyname = 'StocktakeOpeningCosts: admin only') THEN
    CREATE POLICY "StocktakeOpeningCosts: admin only" ON public.stocktake_opening_costs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 5. Stocktake Multi-Counter Resolutions (Admin-Only RLS) ─────────────────
CREATE TABLE IF NOT EXISTS public.stocktake_resolutions (
  stocktake_id      uuid NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  resolution_type   text NOT NULL CHECK (resolution_type IN ('sum', 'override')),
  chosen_line_id    uuid REFERENCES public.stocktake_lines(id) ON DELETE SET NULL,
  resolved_quantity numeric(12,3) NOT NULL CHECK (resolved_quantity >= 0),
  resolved_by       uuid REFERENCES public.users(id),
  resolved_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stocktake_id, variant_id)
);

ALTER TABLE public.stocktake_resolutions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stocktake_resolutions' AND policyname = 'StocktakeResolutions: admin only') THEN
    CREATE POLICY "StocktakeResolutions: admin only" ON public.stocktake_resolutions
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;
