-- =============================================================================
-- Migration: M2a Schema Tables & Ledger Cost Boundary
-- Timestamp: 20261104100000_m2a_schema_tables.sql
-- Description:
--   1. Creates suppliers table with staff/admin RLS
--   2. Creates goods_receipts and goods_receipt_lines (quantities only, zero cost columns)
--   3. Creates isolated admin-only landed cost hook goods_receipt_costs
--   4. Creates isolated admin-only line cost table goods_receipt_line_costs
--   5. Creates derived rebuildable valuation table stock_movement_costs
--   6. Adds opening_cost carrier to variant_costs (admin only)
--   7. Adds allow_negative_stock tenant setting to site_settings (default false)
--   8. Drops unit_cost from stock_movements to permanently eliminate staff PostgREST projection leak
--   9. Realizes honest reference_type check constraint on stock_movements
-- =============================================================================

-- ─── 1. Suppliers Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  contact_info text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Suppliers: staff/admin read') THEN
    CREATE POLICY "Suppliers: staff/admin read" ON public.suppliers
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Suppliers: staff insert') THEN
    CREATE POLICY "Suppliers: staff insert" ON public.suppliers
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Suppliers: admin write') THEN
    CREATE POLICY "Suppliers: admin write" ON public.suppliers
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 2. Goods Receipts Table (Zero Cost Columns) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text UNIQUE NOT NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  posting_date      timestamptz NOT NULL DEFAULT now(),
  reference_note    text,
  note              text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  transaction_id    uuid,
  created_by        uuid REFERENCES public.users(id),
  posted_by         uuid REFERENCES public.users(id),
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_posting_date ON public.goods_receipts(posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON public.goods_receipts(status);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'GoodsReceipts: staff/admin read') THEN
    CREATE POLICY "GoodsReceipts: staff/admin read" ON public.goods_receipts
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'GoodsReceipts: staff draft insert') THEN
    CREATE POLICY "GoodsReceipts: staff draft insert" ON public.goods_receipts
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND status = 'draft'
        AND posted_by IS NULL
        AND posted_at IS NULL
        AND transaction_id IS NULL
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'GoodsReceipts: staff draft update') THEN
    CREATE POLICY "GoodsReceipts: staff draft update" ON public.goods_receipts
      FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND status = 'draft'
      )
      WITH CHECK (
        status = 'draft'
        AND posted_by IS NULL
        AND posted_at IS NULL
        AND transaction_id IS NULL
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'GoodsReceipts: staff draft delete') THEN
    CREATE POLICY "GoodsReceipts: staff draft delete" ON public.goods_receipts
      FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND status = 'draft'
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'GoodsReceipts: admin all') THEN
    CREATE POLICY "GoodsReceipts: admin all" ON public.goods_receipts
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 3. Goods Receipt Landed Cost Hook (Admin Only) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipt_costs (
  receipt_id        uuid PRIMARY KEY REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  additional_costs  numeric(10,2) CHECK (additional_costs >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_costs' AND policyname = 'ReceiptCosts: admin only') THEN
    CREATE POLICY "ReceiptCosts: admin only" ON public.goods_receipt_costs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 4. Goods Receipt Lines Table (Quantities Only) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipt_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id     uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity       numeric(12,3) NOT NULL CHECK (quantity > 0),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON public.goods_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_variant ON public.goods_receipt_lines(variant_id);

ALTER TABLE public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_lines' AND policyname = 'ReceiptLines: staff/admin read') THEN
    CREATE POLICY "ReceiptLines: staff/admin read" ON public.goods_receipt_lines
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_lines' AND policyname = 'ReceiptLines: staff draft insert') THEN
    CREATE POLICY "ReceiptLines: staff draft insert" ON public.goods_receipt_lines
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_lines' AND policyname = 'ReceiptLines: staff draft update') THEN
    CREATE POLICY "ReceiptLines: staff draft update" ON public.goods_receipt_lines
      FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
      )
      WITH CHECK (
        quantity > 0
        AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_lines' AND policyname = 'ReceiptLines: staff draft delete') THEN
    CREATE POLICY "ReceiptLines: staff draft delete" ON public.goods_receipt_lines
      FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
        AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_lines' AND policyname = 'ReceiptLines: admin all') THEN
    CREATE POLICY "ReceiptLines: admin all" ON public.goods_receipt_lines
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 5. Goods Receipt Line Costs (Admin Only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipt_line_costs (
  line_id     uuid PRIMARY KEY REFERENCES public.goods_receipt_lines(id) ON DELETE CASCADE,
  unit_cost   numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_line_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_line_costs' AND policyname = 'ReceiptLineCosts: admin only') THEN
    CREATE POLICY "ReceiptLineCosts: admin only" ON public.goods_receipt_line_costs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 6. Derived Rebuildable Valuation Table (Admin Only) ─────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movement_costs (
  movement_id               uuid PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
  variant_id                uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  posting_date              timestamptz NOT NULL,
  created_at                timestamptz NOT NULL,
  quantity_delta            numeric(12,3) NOT NULL,
  unit_cost                 numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost                numeric(12,2) NOT NULL,
  running_quantity          numeric(12,3) NOT NULL,
  running_cost_basis_qty    numeric(12,3) NOT NULL,
  running_avg_cost          numeric(10,4) NOT NULL CHECK (running_avg_cost >= 0),
  has_unknown_cost_basis    boolean NOT NULL DEFAULT false,
  computed_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smc_replay_order
  ON public.stock_movement_costs(variant_id, posting_date ASC, created_at ASC, movement_id ASC);

ALTER TABLE public.stock_movement_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_movement_costs' AND policyname = 'MovementCosts: admin only') THEN
    CREATE POLICY "MovementCosts: admin only" ON public.stock_movement_costs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;


-- ─── 7. Variant Costs Opening Cost Carrier (Admin Only) ──────────────────────
ALTER TABLE public.variant_costs
  ADD COLUMN IF NOT EXISTS opening_cost numeric(10,2) CHECK (opening_cost >= 0);


-- ─── 8. Tenant Settings: Allow Negative Stock ─────────────────────────────────
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;


-- ─── 9. Stock Movements: Drop unit_cost & Realize reference_type Check ───────
ALTER TABLE public.stock_movements
  DROP COLUMN IF EXISTS unit_cost;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS negative_stock_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (reference_type IN ('order', 'goods_receipt_line', 'purchase_order', 'stocktake', 'manual'));
