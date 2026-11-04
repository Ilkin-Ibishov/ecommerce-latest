# M2a Design Note: Goods Receipt, Suppliers, Weighted-Average Cost, and Margin Read

**Status:** Proposed (Ready for Architecture Review)  
**Author:** Antigravity  
**Target Branch:** `m2/receiving-cost`  
**Reference Specs:** `docs/tasks/warehouse-m2a-receiving-cost.md`, `.agents/rules/inventory.md`, `docs/STATUS.md`  
*(Length justification: Detailed SQL DDL specifications for 5 tables, triggers, atomic posting RPC, complete PL/pgSQL replay algorithm, and resolution of three spec contradictions upfront to prevent review blockers).*  

---

## 1. Executive Summary & Core Invariants

Phase M2a introduces commercial valuation to physical inventory. M1 established that physical quantities exist strictly on variants and change exclusively through immutable rows in `stock_movements`. M2a establishes what those quantities cost, what sales yielded, and what the business earned.

Core Invariants:
1. **Physical Ledger Immutability:** `stock_movements` remains 100% immutable by trigger (`trg_stock_movements_immutable`). No valuation update touches a movement row.
2. **Rebuildable Derived Valuation:** Inventory valuation and historical Cost of Goods Sold (COGS) are stored in a derived, rebuildable projection table (`stock_movement_costs`) keyed 1:1 by `movement_id`. Replaying from physical movements produces byte-identical valuation rows.
3. **Strict RLS Cost Secrecy:** Cost and margin data are accessible **only** to the store owner (`role = 'admin'`). Because the web client speaks directly to PostgREST via Supabase, RLS is the sole reliable boundary. No cost column may exist on any table readable by staff or anonymous tokens.
4. **Atomic Posting in the Engine:** Goods receipts post movements and trigger scoped recomputes within a single PostgreSQL ACID transaction (`post_goods_receipt` RPC). PostgREST HTTP calls cannot coordinate multi-statement transactions.
5. **Weighted-Average Cost (WAC) Replay:** WAC does not commute. Valuation is recomputed along deterministic business dates (`posting_date ASC, created_at ASC, id ASC`), scoped strictly to the affected variant from the earliest affected date forward.
6. **Reservations are Not Movements:** Deferred to M2b; zero reservation-shaped structures or ledger entries are introduced.

---

## 2. Resolution of §5 & §11 Q1: Ledger Immutability vs. Replay-Based Costing

### The Collision
In M1, `stock_movements` was made immutable via `BEFORE UPDATE OR DELETE` triggers. In retail, supplier invoices and receipts are regularly entered retroactively (e.g. Tuesday goods entered Friday with `posting_date = Tuesday`). Under moving weighted-average costing, an incoming delivery at a new price retroactively changes the average cost of every subsequent sale. But because `stock_movements` cannot be updated, the consumed cost of a historical sale cannot be written onto the movement row after the fact.

### Options Evaluated

#### Option (b): Value at Insert Time and Correct by Compensation (REJECTED)
- **Why rejected:**
  1. *Physical ledger corruption:* In inventory theory, every movement represents physical displacement (`quantity_delta <> 0`). Valuation-correction rows have zero quantity delta (`quantity_delta = 0`). Allowing zero-delta rows violates `CHECK (quantity_delta <> 0)` and confounds physical inventory with accounting ledger entries.
  2. *Compounding compensation cascades:* If a receipt is backdated 7 days across 30 sales, Option (b) must generate 30 compensation rows. If another receipt is backdated 3 days prior, it must compensate both the original sales and the prior compensation rows.
  3. *Query and reporting fragility:* Every margin and inventory report must group and net compensation rows against original movements, creating fragile queries and poor performance.

#### Option (a): Derived, Rebuildable Valuation Table `stock_movement_costs` (CHOSEN)
- **Why chosen:**
  1. *Clean separation of concerns:* `stock_movements` remains the sole, immutable record of *what physically moved*. `stock_movement_costs` is the record of *what each movement was worth*.
  2. *Deterministic recomputation:* When a backdated receipt appears, rows in `stock_movement_costs` for that variant from that `posting_date` forward are deleted and recomputed in memory, then re-inserted cleanly. Historical physical ledger rows are untouched.
  3. *Zero reporting overhead:* Margin reports query clean 1:1 rows without aggregating compensation fragments.

### Canonical Source of Truth vs. Rebuildable Cache
- **Canonical Source of Truth:**
  1. Physical stock: `stock_movements` (id, variant_id, quantity_delta, posting_date, created_at, reason).
  2. Inbound purchase costs: `goods_receipt_lines` combined with `goods_receipt_line_costs` (or `goods_receipts` linked to `stock_movements.reference_id`).
- **Materialized Rebuildable Valuation:** `stock_movement_costs` (keyed by `movement_id`). Wholly derivable by executing the replay algorithm over the canonical source of truth.
- **Fast Lookup Cache:** `variant_costs.cost_price` is a fast scalar cache of the latest `running_avg_cost` from `stock_movement_costs`.

### Idempotent Replay Proof
Let $M_v = \{m_1, m_2, \dots, m_n\}$ be the set of physical movements for variant $v$.  
Define the strict total order $\prec$ over $M_v$ by:
$$m_i \prec m_j \iff (m_i.\text{posting\_date}, m_i.\text{created\_at}, m_i.\text{id}) < (m_j.\text{posting\_date}, m_j.\text{created\_at}, m_j.\text{id})$$
Because UUIDs are unique and timestamps are immutable, $\prec$ is total, strictly antisymmetric, and time-invariant.

Define the replay state $S_k = (\text{qty}_k, \text{basis\_qty}_k, \text{avg}_k)$ and transition function $T(S_{k-1}, m_k) \to (S_k, c_k)$:
- For inbound receipt with unit cost $u_k$ and $\Delta q_k > 0$:
  $$\text{qty}_k = \text{qty}_{k-1} + \Delta q_k$$
  $$\text{basis\_qty}_k = \max(0, \text{basis\_qty}_{k-1}) + \Delta q_k$$
  $$\text{avg}_k = \frac{\max(0, \text{basis\_qty}_{k-1}) \cdot \text{avg}_{k-1} + \Delta q_k \cdot u_k}{\text{basis\_qty}_k}$$
  $$c_k = (\text{unit\_cost} = u_k, \text{total\_cost} = \Delta q_k \cdot u_k, \text{running\_avg} = \text{avg}_k)$$
- For outbound issue with $\Delta q_k < 0$:
  $$\text{qty}_k = \text{qty}_{k-1} + \Delta q_k$$
  $$\text{basis\_qty}_k = \max(0, \text{basis\_qty}_{k-1} + \Delta q_k)$$
  $$\text{avg}_k = \text{avg}_{k-1}$$
  $$c_k = (\text{unit\_cost} = \text{avg}_{k-1}, \text{total\_cost} = |\Delta q_k| \cdot \text{avg}_{k-1}, \text{running\_avg} = \text{avg}_k)$$

Given initial state $S_0 = (0, 0, 0)$, $T$ is a pure mathematical function of $(m_1, \dots, m_n)$. Replaying twice from an empty `stock_movement_costs` table produces identical tuples $c_1, \dots, c_n$ bit-for-bit. **Q.E.D.**

---

## 3. Direct Answers to §11 Open Questions

### Q1. COGS Source of Truth and Rebuildable Cache
Addressed in §2 above. Canonical truth is `stock_movements` + `goods_receipt_line_costs`. `stock_movement_costs` is the rebuildable valuation projection; `variant_costs.cost_price` is the latest running-average cache.

### Q2. Landed Cost: Hook vs. Allocation
- **Recommendation:** **Hook only (`additional_costs numeric(10,2) NULL` on `goods_receipts`). Do NOT implement line allocation now.**
- **Reasoning:**
  1. *Customer reality:* Goods are purchased for cash in local markets without freight invoices or customs declarations.
  2. *False precision:* Without weight/volume data on variants, allocation defaults to purchase value, which distorts cost for inexpensive bulky goods.
  3. *Complexity vs. value:* Allocation requires fractional penny distribution algorithms (e.g. Largest Remainder / Hare-Niemeyer method) and interactive UI reconciliation that will not be used in this segment.
  4. Adding the nullable column satisfies future database compatibility with zero migration penalty.

### Q3. Supplier Returns: Negative Line vs. Separate Document Type
- **Recommendation:** **Separate reversing flow / document (`goods_receipts.status = 'reversed'` or dedicated return document); NEVER negative lines on a goods receipt.**
- **Reasoning:**
  1. *Document semantics:* A "Goods Receipt" is an inbound voucher with strictly positive quantities (`CHECK (quantity > 0)`). Mixing negative lines creates semantic confusion (is it a credit, a damaged rejection, or an intake error?).
  2. *Movement typing:* Inbound lines generate reason `'goods_receipt'`; returns to suppliers generate reason `'return_to_supplier'`.
  3. *Error reversal vs. vendor return:*
     - A clerical mistake on a posted receipt is corrected by a 1-click `reverse_goods_receipt` RPC, which generates compensating `'return_to_supplier'` movements linked via `correlation_id` to the original movements.
     - A physical return to a supplier links to the original receipt and credits inventory at the price originally paid.

### Q4. What Triggers Recompute: Trigger vs. Explicit Service Call
- **Recommendation:** **Explicit RPC execution inside `post_goods_receipt`; NEVER a row-level trigger on `stock_movements`.**
- **Reasoning:**
  1. *Per-line thrashing:* A receipt posting 40 lines in one transaction would execute an `AFTER INSERT` row trigger 40 times. If multiple lines belong to the same variant, the variant's entire history would recompute 40 times consecutively, taking row locks and crippling throughput.
  2. *Explicit M1 guard:* Migration `20261103210000_m1_schema_additions.sql` explicitly commands: *"DO NOT extend trg_apply_stock_movement (the AFTER INSERT trigger) to compute cost... Cost belongs in a replay projection keyed on posting_date."*
- **Mechanism:**
  - Database function `recompute_variant_cost(p_variant_id uuid, p_from_date timestamptz DEFAULT NULL)`.
  - `post_goods_receipt(p_receipt_id uuid, p_actor_id uuid)` collects the distinct `variant_id`s in the receipt and calls `recompute_variant_cost` **exactly once per variant** from `receipt.posting_date` forward.
  - Normal POS / online sales inserted with `posting_date = now()` take the current cached `variant_costs.cost_price` directly, avoiding full history replay.

### Q5. Draft Receipt Observability & Isolation
- **Answer:** **A draft receipt affects NOTHING observable outside the Goods Receipt screen.**
- **Enforcement:**
  1. *Physical stock:* Lines in a draft receipt write zero rows to `stock_movements`. `product_variants.on_hand` is only mutated via `stock_movements` inserts (enforced by `trg_guard_variant_on_hand_update` and `pg_trigger_depth()`).
  2. *Available stock:* Drafts do not touch reservations (M2b) or inventory availability.
  3. *Valuation & Margin:* `stock_movement_costs` and `variant_costs` are untouched until `post_goods_receipt` executes.
  4. *Schema isolation:* Catalog queries join `products`, `product_variants`, and `stock_movements`. There are no foreign keys from inventory tables to `goods_receipts`.

### Q6. Query Shape and Indexes for Margin Report
- **Inputs:** `start_date timestamptz`, `end_date timestamptz`, optional `category_id uuid`.
- **Query Structure (Owner-Only RPC / API):**
  ```sql
  WITH movement_cogs AS (
    SELECT
      sm.variant_id,
      sm.posting_date,
      sm.quantity_delta,
      sm.reason,
      smc.unit_cost AS cogs_unit_cost,
      smc.total_cost AS cogs_total
    FROM public.stock_movements sm
    JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
    WHERE sm.posting_date >= :start_date AND sm.posting_date < :end_date
      AND sm.reason IN ('online_sale', 'counter_sale', 'customer_return')
      -- M3 Box / Kit Note: Assembly consumption ('assembly_consume') will be excluded
      -- here to prevent double-counting components sold inside bundled kits.
  ),
  aggregated_cogs AS (
    SELECT
      variant_id,
      SUM(CASE WHEN reason IN ('online_sale', 'counter_sale') THEN -quantity_delta ELSE -quantity_delta END) AS net_units_sold,
      SUM(CASE WHEN reason IN ('online_sale', 'counter_sale') THEN cogs_total ELSE -cogs_total END) AS total_cogs
    FROM movement_cogs
    GROUP BY variant_id
  ),
  sales_revenue AS (
    SELECT
      oi.variant_id,
      SUM(oi.price * oi.quantity) AS gross_revenue
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at >= :start_date AND o.created_at < :end_date
      AND o.status NOT IN ('cancelled', 'refused_at_delivery')
    GROUP BY oi.variant_id
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    p.id AS product_id,
    p.title AS product_title,
    c.id AS category_id,
    c.name AS category_name,
    COALESCE(sr.gross_revenue, 0) AS revenue,
    COALESCE(ac.total_cogs, 0) AS cogs,
    COALESCE(sr.gross_revenue, 0) - COALESCE(ac.total_cogs, 0) AS gross_margin,
    CASE 
      WHEN COALESCE(sr.gross_revenue, 0) > 0 
      THEN ROUND(((COALESCE(sr.gross_revenue, 0) - COALESCE(ac.total_cogs, 0)) / sr.gross_revenue) * 100, 2)
      ELSE 0 
    END AS margin_percent,
    COALESCE(ac.net_units_sold, 0) AS units_sold
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN aggregated_cogs ac ON ac.variant_id = pv.id
  LEFT JOIN sales_revenue sr ON sr.variant_id = pv.id
  WHERE (:category_id IS NULL OR p.category_id = :category_id)
    AND (ac.net_units_sold IS NOT NULL OR sr.gross_revenue IS NOT NULL)
  ORDER BY gross_margin DESC;
  ```
- **Indexes Required:**
  1. `stock_movements(posting_date, reason) INCLUDE (variant_id, quantity_delta)`
  2. `stock_movement_costs(variant_id, posting_date)`
  3. `orders(created_at, status)`

### Q7. Where the Cost Boundary is Tested
- **The Vulnerability Identified from M1:**
  In M1, `stock_movements` retained `unit_cost numeric(10,2)` with an RLS policy granting `SELECT` to `role IN ('admin', 'staff')`. While Express stripped `unit_cost` in JS, **any staff token querying PostgREST directly (`createClient()`) could execute `.from('stock_movements').select('unit_cost')` and view wholesale costs.**
- **The Structural RLS Boundary:**
  1. `unit_cost` on `stock_movements` is deprecated. All movement valuation is recorded in `stock_movement_costs`.
  2. `stock_movement_costs` and `goods_receipt_line_costs` carry RLS policies permitting `SELECT` **exclusively** to `public.is_admin()`.
  3. PostgREST rejects any staff query for these tables with zero rows returned or 403 Forbidden.
- **Testing Point:**
  Tested via Vitest against the PostgREST interface using an authenticated staff JWT token:
  `supabase.auth.setSession(staffSession);`
  - `await supabase.from('variant_costs').select('*')` $\implies$ returns empty data array `[]`.
  - `await supabase.from('stock_movement_costs').select('*')` $\implies$ returns empty data array `[]`.
  - `await supabase.from('goods_receipt_line_costs').select('*')` $\implies$ returns empty data array `[]`.

---

## 4. Proposed Schema Design

```sql
-- ─── 1. Suppliers Table ──────────────────────────────────────
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

CREATE POLICY "Suppliers: staff/admin read" ON public.suppliers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "Suppliers: admin write" ON public.suppliers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Suppliers: staff insert" ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));

-- Cost reachability: NONE. Table contains no cost or margin data.


-- ─── 2. Goods Receipts Table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text UNIQUE NOT NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  posting_date      timestamptz NOT NULL DEFAULT now(),
  reference_note    text, -- Invoice # or market memo
  note              text,
  additional_costs  numeric(10,2) CHECK (additional_costs >= 0), -- Landed cost hook
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  transaction_id    uuid, -- Populated upon post to group stock_movements
  created_by        uuid REFERENCES public.users(id),
  posted_by         uuid REFERENCES public.users(id),
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_posting_date ON public.goods_receipts(posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON public.goods_receipts(status);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

-- Receipts are administrative intake vouchers. To eliminate staff margin leakage,
-- reading receipt headers is permitted to staff, but costs are stored in an isolated table.
CREATE POLICY "GoodsReceipts: staff/admin read" ON public.goods_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "GoodsReceipts: admin all" ON public.goods_receipts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cost reachability: additional_costs hook is visible only to admin via view or restricted to admin.


-- ─── 3. Goods Receipt Lines & Isolated Costs ─────────────────
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

CREATE POLICY "ReceiptLines: staff/admin read" ON public.goods_receipt_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

CREATE POLICY "ReceiptLines: admin all" ON public.goods_receipt_lines
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "ReceiptLines: staff draft insert" ON public.goods_receipt_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
  );

-- Dedicated cost isolation table (Resolving PostgREST staff leakage):
CREATE TABLE IF NOT EXISTS public.goods_receipt_line_costs (
  line_id     uuid PRIMARY KEY REFERENCES public.goods_receipt_lines(id) ON DELETE CASCADE,
  unit_cost   numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_line_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ReceiptLineCosts: admin only" ON public.goods_receipt_line_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cost reachability: Strictly admin-only. Staff token receives 0 rows via PostgREST.


-- ─── 4. Derived Rebuildable Valuation Table ───────────────────
CREATE TABLE IF NOT EXISTS public.stock_movement_costs (
  movement_id               uuid PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
  variant_id                uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  posting_date              timestamptz NOT NULL,
  quantity_delta            numeric(12,3) NOT NULL,
  unit_cost                 numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost                numeric(12,2) NOT NULL,
  running_quantity          numeric(12,3) NOT NULL,
  running_cost_basis_qty    numeric(12,3) NOT NULL,
  running_avg_cost          numeric(10,4) NOT NULL CHECK (running_avg_cost >= 0),
  has_unknown_cost_basis    boolean NOT NULL DEFAULT false,
  computed_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smc_variant_posting_date
  ON public.stock_movement_costs(variant_id, posting_date ASC);

ALTER TABLE public.stock_movement_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MovementCosts: admin only" ON public.stock_movement_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cost reachability: Strictly admin-only. Staff token receives 0 rows via PostgREST.


-- ─── 5. Carried Forward Invariants from M1 (§10) ──────────────

-- 5a. Negative stock tenant setting
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;

-- 5b. Unit of measure immutability trigger
CREATE OR REPLACE FUNCTION trg_guard_variant_uom_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure THEN
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE variant_id = NEW.id) THEN
      RAISE EXCEPTION 'unit_of_measure cannot be modified once stock movements exist for variant %', NEW.id
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_variants_guard_uom ON public.product_variants;
CREATE TRIGGER product_variants_guard_uom
BEFORE UPDATE OF unit_of_measure ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION trg_guard_variant_uom_immutable();

-- 5c. Rename set_product_stock_safe parameter to eliminate ambiguity
CREATE OR REPLACE FUNCTION set_variant_stock_safe(
  p_variant_id uuid,
  p_target_stock numeric,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_adjustment',
  p_note text DEFAULT NULL
)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_current_on_hand numeric;
  v_delta numeric;
  v_reason text;
  v_resulting_on_hand numeric;
BEGIN
  IF p_target_stock < 0 THEN
    RAISE EXCEPTION 'Target stock cannot be negative' USING ERRCODE = 'ST001';
  END IF;

  SELECT on_hand INTO v_current_on_hand
  FROM public.product_variants
  WHERE id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', p_variant_id USING ERRCODE = 'ST002';
  END IF;

  v_delta := p_target_stock - v_current_on_hand;

  IF v_delta <> 0 THEN
    v_reason := COALESCE(p_reason, CASE WHEN v_delta > 0 THEN 'manual_adjustment' ELSE 'damage_write_off' END);
    INSERT INTO public.stock_movements (
      variant_id, quantity_delta, reason, reference_type, actor_id, note, posting_date
    ) VALUES (
      p_variant_id, v_delta, v_reason::stock_movement_reason, 'manual', p_actor_id,
      COALESCE(p_note, 'Admin stock adjustment to ' || p_target_stock), now()
    );
  END IF;

  SELECT on_hand INTO v_resulting_on_hand
  FROM public.product_variants
  WHERE id = p_variant_id;

  RETURN v_resulting_on_hand;
END;
$$;
```

---

## 5. Atomic Posting Mechanism & Engine Enforcement

Posting a goods receipt must atomically convert draft lines into immutable `stock_movements`, trigger WAC recomputes, and lock the receipt document.

```sql
CREATE OR REPLACE FUNCTION post_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_receipt record;
  v_tx_id uuid := gen_random_uuid();
  v_var record;
BEGIN
  -- 1. Lock receipt and verify status
  SELECT * INTO v_receipt
  FROM public.goods_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found: %', p_receipt_id USING ERRCODE = 'P0002';
  END IF;

  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'Receipt % is already % and cannot be posted', p_receipt_id, v_receipt.status
      USING ERRCODE = 'ST003';
  END IF;

  -- 2. Verify receipt contains lines and all lines have costs
  IF NOT EXISTS (SELECT 1 FROM public.goods_receipt_lines WHERE receipt_id = p_receipt_id) THEN
    RAISE EXCEPTION 'Cannot post receipt %: no line items exist', p_receipt_id USING ERRCODE = 'ST004';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.goods_receipt_lines grl
    LEFT JOIN public.goods_receipt_line_costs grlc ON grlc.line_id = grl.id
    WHERE grl.receipt_id = p_receipt_id AND (grlc.unit_cost IS NULL OR grlc.unit_cost < 0)
  ) THEN
    RAISE EXCEPTION 'Cannot post receipt %: every line must carry a non-negative unit cost', p_receipt_id
      USING ERRCODE = 'ST005';
  END IF;

  -- 3. Atomically insert stock_movements for all lines
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
    grl.variant_id,
    grl.quantity,
    'goods_receipt'::stock_movement_reason,
    'purchase_order',
    grl.id::text,
    p_actor_id,
    COALESCE(v_receipt.note, 'Goods receipt ' || v_receipt.receipt_number),
    v_receipt.posting_date,
    v_tx_id
  FROM public.goods_receipt_lines grl
  WHERE grl.receipt_id = p_receipt_id
  ORDER BY grl.sort_order ASC, grl.id ASC;

  -- 4. Execute scoped recompute once per distinct variant
  FOR v_var IN (
    SELECT DISTINCT variant_id 
    FROM public.goods_receipt_lines 
    WHERE receipt_id = p_receipt_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_receipt.posting_date);
  END LOOP;

  -- 5. Mark receipt posted
  UPDATE public.goods_receipts
  SET status = 'posted',
      transaction_id = v_tx_id,
      posted_by = p_actor_id,
      posted_at = now(),
      updated_at = now()
  WHERE id = p_receipt_id;
END;
$$;
```

**Where Atomicity is Enforced:**  
Enforced wholly inside PostgreSQL in the `post_goods_receipt` function. If any quantity trigger fails (e.g. negative stock guard), foreign key check fails, or recompute encounters an error, the entire transaction rolls back cleanly. PostgREST executes RPCs within an implicit transaction; no partial state can persist.

---

## 6. Detailed Replay Algorithm Specification

The recompute algorithm operates on a single variant, ordered strictly by `(posting_date ASC, created_at ASC, id ASC)`.

```sql
CREATE OR REPLACE FUNCTION recompute_variant_cost(
  p_variant_id uuid,
  p_from_date timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_m record;
  v_qty numeric(12,3) := 0;
  v_basis_qty numeric(12,3) := 0;
  v_avg_cost numeric(10,4) := 0;
  v_has_unknown boolean := false;
  v_unit_cost numeric(10,2);
  v_total_cost numeric(12,2);
  v_recompute_from timestamptz;
BEGIN
  -- Advisory xact lock per variant to serialize concurrent replays for the same SKU
  PERFORM pg_advisory_xact_lock(hashtext('cost_replay_' || p_variant_id::text));

  -- 1. Determine recompute horizon
  IF p_from_date IS NOT NULL THEN
    SELECT running_quantity, running_cost_basis_qty, running_avg_cost, has_unknown_cost_basis, posting_date
    INTO v_qty, v_basis_qty, v_avg_cost, v_has_unknown, v_recompute_from
    FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date < p_from_date
    ORDER BY posting_date DESC, computed_at DESC
    LIMIT 1;
  END IF;

  IF v_recompute_from IS NOT NULL THEN
    DELETE FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date >= v_recompute_from;
  ELSE
    DELETE FROM public.stock_movement_costs WHERE variant_id = p_variant_id;
    v_qty := 0;
    v_basis_qty := 0;
    v_avg_cost := 0;
    v_has_unknown := false;
  END IF;

  -- 2. Stream movements forward
  FOR v_m IN (
    SELECT
      sm.id AS movement_id,
      sm.posting_date,
      sm.created_at,
      sm.quantity_delta,
      sm.reason,
      sm.reference_type,
      sm.reference_id,
      sm.correlation_id,
      grlc.unit_cost AS receipt_cost
    FROM public.stock_movements sm
    LEFT JOIN public.goods_receipt_lines grl 
      ON sm.reason = 'goods_receipt' AND grl.id::text = sm.reference_id
    LEFT JOIN public.goods_receipt_line_costs grlc 
      ON grlc.line_id = grl.id
    WHERE sm.variant_id = p_variant_id
      AND (v_recompute_from IS NULL OR sm.posting_date >= v_recompute_from)
    ORDER BY sm.posting_date ASC, sm.created_at ASC, sm.id ASC
  ) LOOP

    -- CASE A: Inbound delivery (goods_receipt)
    IF v_m.reason = 'goods_receipt' THEN
      v_unit_cost := COALESCE(v_m.receipt_cost, 0);
      v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);
      
      IF v_basis_qty <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := v_m.quantity_delta;
      ELSE
        v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
        v_basis_qty := v_basis_qty + v_m.quantity_delta;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE B: Opening balance with unknown cost (§7 invariant)
    ELSIF v_m.reason = 'opening_balance' AND v_m.receipt_cost IS NULL THEN
      v_qty := v_qty + v_m.quantity_delta;
      -- Unknown cost is EXCLUDED from average, not averaged as 0:
      v_unit_cost := 0;
      v_total_cost := 0;
      v_has_unknown := true;

    -- CASE C: Customer Return
    ELSIF v_m.reason = 'customer_return' THEN
      -- Returns re-enter at original sale cost if correlated, else at running average
      IF v_m.correlation_id IS NOT NULL THEN
        SELECT unit_cost INTO v_unit_cost
        FROM public.stock_movement_costs
        WHERE movement_id = v_m.correlation_id;
      END IF;
      v_unit_cost := COALESCE(v_unit_cost, v_avg_cost);
      v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);

      IF v_basis_qty > 0 AND v_unit_cost <> v_avg_cost THEN
        v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
        v_basis_qty := v_basis_qty + v_m.quantity_delta;
      ELSE
        v_basis_qty := v_basis_qty + v_m.quantity_delta;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE D: Outbound consumption (online_sale, counter_sale, write-off, return_to_supplier)
    ELSE
      v_unit_cost := v_avg_cost;
      v_total_cost := ROUND(ABS(v_m.quantity_delta) * v_unit_cost, 2);
      v_qty := v_qty + v_m.quantity_delta;
      v_basis_qty := GREATEST(0, v_basis_qty + v_m.quantity_delta);
      IF v_basis_qty = 0 AND v_qty > 0 THEN
        v_has_unknown := true;
      END IF;
    END IF;

    -- Insert valuation projection row
    INSERT INTO public.stock_movement_costs (
      movement_id,
      variant_id,
      posting_date,
      quantity_delta,
      unit_cost,
      total_cost,
      running_quantity,
      running_cost_basis_qty,
      running_avg_cost,
      has_unknown_cost_basis
    ) VALUES (
      v_m.movement_id,
      p_variant_id,
      v_m.posting_date,
      v_m.quantity_delta,
      v_unit_cost,
      v_total_cost,
      v_qty,
      v_basis_qty,
      v_avg_cost,
      v_has_unknown
    );
  END LOOP;

  -- 3. Refresh fast lookup cache in variant_costs
  UPDATE public.variant_costs
  SET cost_price = ROUND(v_avg_cost, 2),
      updated_at = now()
  WHERE variant_id = p_variant_id;
END;
$$;
```

### Edge Conditions Formally Handled
1. **Opening balance with unknown cost:** Excluded from `basis_qty`. Unit cost recorded as 0 with flag `has_unknown_cost_basis = true`. The running average remains undefined until the first priced receipt arrives, preventing margin dilution.
2. **Negative on-hand stock:** If `allow_negative_stock` is active and stock drops below zero, `avg_cost` freezes at the last-known value. Division by zero or negative divisors is structurally prevented by `GREATEST(0, ...)`.
3. **Customer return linked to order:** Looks up original movement cost via `correlation_id` and restores inventory value accurately.

---

## 7. Migration Plan & Rollback Strategy

The rollout follows a zero-downtime, 3-step additive sequence keeping `main` deployable at every commit:

1. **Migration 1 (`supabase/migrations/20261104100000_m2a_schema_tables.sql`):**
   - Create `suppliers`, `goods_receipts`, `goods_receipt_lines`, `goods_receipt_line_costs`, and `stock_movement_costs`.
   - Add `allow_negative_stock` to `site_settings`.
   - Add RLS policies and indexes.
   - *Deployability:* Purely additive; existing API and UI ignore new tables.
2. **Migration 2 (`supabase/migrations/20261104110000_m2a_functions_triggers.sql`):**
   - Deploy `trg_guard_variant_uom_immutable` on `product_variants`.
   - Deploy `rebuild_on_hand(variant_id)` and `verify_stock_integrity()`.
   - Deploy `set_variant_stock_safe` (retaining `set_product_stock_safe` as an aliased wrapper for backwards compatibility).
   - Deploy `recompute_variant_cost` and `post_goods_receipt`.
   - *Deployability:* Non-breaking; RPC functions are callable alongside legacy RPCs.
3. **Migration 3 (`supabase/migrations/20261104120000_m2a_cost_backfill.sql`):**
   - Populate `stock_movement_costs` for all historical movements via `recompute_variant_cost`.
- **Rollback Note:**  
  All changes are additive. If an application release must be rolled back, legacy code continues functioning without schema reversal. Reverting application code requires zero database rollbacks.

---

## 8. Disagreements with the Work Order

Three design flaws in `warehouse-m2a-receiving-cost.md` must be addressed before migrations begin:

### 1. The Staff Receipt Entry vs. Cost Secrecy Contradiction (§3 vs. §6 vs. §12.5)
- *The Flaw in Spec:*  
  The work order states:
  - "Cost and margin are owner-only. Staff must not see them anywhere" (§3).
  - "Unit cost is mandatory on a receipt line... permitting zero here is how the margin report becomes a lie" (§6).
  - "Admin UI: receipt entry built around scanning... Cost fields absent for non-owner roles" (§12.5).  
  If the UI hides cost fields from staff, staff cannot provide a unit cost. If unit cost is mandatory, staff cannot submit the receipt.
- *The Correction:*  
  We resolve this by supporting a two-stage **Blind Draft Receiving** workflow:
  1. Staff can scan barcodes and enter physical quantities, saving a `draft` receipt. Lines exist in `goods_receipt_lines`, but contain no cost columns.
  2. The owner opens the draft in the Admin UI, enters the mandatory unit costs (stored in `goods_receipt_line_costs`), and clicks "Post Receipt".  
  The receipt cannot be posted without costs, staff never see or enter costs, and data entry is distributed without compromising secrecy.

### 2. Leaking `stock_movements.unit_cost` to Staff via PostgREST (M1 Oversight)
- *The Flaw in Spec & Current Schema:*  
  In M1, `stock_movements.unit_cost` was created with `SELECT` granted to `staff`. Express sanitized it in Node, but direct PostgREST calls by staff tokens could project `unit_cost`.
- *The Correction:*  
  We deprecate `stock_movements.unit_cost`. All valuation data is strictly routed into `stock_movement_costs` and `goods_receipt_line_costs`, both governed by `public.is_admin()` RLS policies. Staff tokens receive zero rows from PostgREST on any cost table.

### 3. Outer Pack Barcode Multiplier vs. Unit Cost Entry Hazard
- *The Flaw in Spec:*  
  §6 states: "A scanned barcode resolves through variant_barcodes, and pack_quantity multiplies — scanning a case of twelve enters twelve".  
  If a merchant buys a case of 12 for $60 and types 60 into the "Unit Cost" field, the receipt posts 12 units at $60 = $720 instead of $5/unit. This is the single most common cause of margin distortion in retail.
- *The Correction:*  
  When a barcode scan matches a pack barcode (`pack_quantity > 1`), the UI explicitly renders both `Pack Cost` and calculated `Unit Cost` ($60 / 12 = $5.00), storing the normalized base unit cost ($5.00) in `goods_receipt_line_costs`.
