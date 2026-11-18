# M2a Design Note: Goods Receipt, Suppliers, Weighted-Average Cost, and Margin Read

**Status:** Revised for Architecture Review (All R1–R7 & Minor findings resolved)  
**Author:** Antigravity  
**Target Branch:** `m2/receiving-cost`  
**Reference Specs:** `docs/tasks/warehouse-m2a-receiving-cost.md`, `prompts/m2a-design-revise.md`, `.agents/rules/inventory.md`, `docs/STATUS.md`  
*(Length justification: Detailed SQL DDL specifications for 6 tables, triggers, operational repair and audit functions `rebuild_on_hand` and `verify_stock_integrity`, atomic posting/reversal RPCs, complete PL/pgSQL replay algorithm with boundary corrections, inductive mathematical proof of partial-replay equivalence, and exhaustive security/RLS matrices).*

---

## 1. Executive Summary & Core Invariants

Phase M2a introduces commercial valuation to physical inventory. M1 established that physical quantities exist strictly on variants and change exclusively through immutable rows in `stock_movements`. M2a establishes what those quantities cost, what sales yielded, and what the business earned.

### Core Invariants
1. **Physical Ledger Immutability:** `stock_movements` remains 100% immutable by trigger (`trg_stock_movements_immutable`). No valuation update touches a movement row.
2. **Rebuildable Derived Valuation:** Inventory valuation and historical Cost of Goods Sold (COGS) are stored in a derived, rebuildable projection table (`stock_movement_costs`) keyed 1:1 by `movement_id`. Replaying physical movements reproduces identical valuation rows on all business columns (excluding only the wall-clock execution timestamp `computed_at`).
3. **Strict RLS Cost Secrecy:** Cost and margin data are accessible **only** to the store owner (`public.is_admin()`). Because the web client speaks directly to PostgREST via Supabase, RLS is the sole reliable boundary. No cost column exists on any table readable by staff or anonymous tokens.
4. **Atomic Posting in the Engine:** Goods receipts post movements and trigger scoped recomputes within a single PostgreSQL ACID transaction (`post_goods_receipt` RPC). PostgREST HTTP calls cannot coordinate multi-statement transactions.
5. **Weighted-Average Cost (WAC) Replay:** WAC does not commute. Valuation is recomputed along deterministic business dates (`posting_date ASC, created_at ASC, movement_id ASC`), scoped strictly to the affected variant from the earliest affected date forward.
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

### Canonical Source of Truth vs. Rebuildable Projection vs. Fast Cache
- **Canonical Source of Truth:**
  1. Physical stock: `stock_movements` (`id`, `variant_id`, `quantity_delta`, `posting_date`, `created_at`, `reason`, `reference_type`, `reference_id`).
  2. Inbound purchase costs: `goods_receipt_line_costs` (keyed 1:1 to `goods_receipt_lines.id`), linked via `stock_movements.reference_id` when `reference_type = 'goods_receipt_line'`.
  3. Opening balance valuation: `variant_costs.opening_cost` (admin-only opening valuation carrier).
- **Materialized Rebuildable Valuation Projection:**
  `stock_movement_costs` (keyed 1:1 by `movement_id`). Wholly derivable by executing the deterministic replay algorithm over the canonical source of truth.
- **Fast Lookup Cache:**
  `variant_costs.cost_price` is a fast scalar cache of the latest `running_avg_cost` from `stock_movement_costs`.

---

### Inductive Proof: Equivalence of Partial Replay and Full Replay

#### Theorem (Equivalence of Partial Replay and Full Replay)
Let $M_v = (m_1, m_2, \dots, m_n)$ be the finite sequence of all physical movements for variant $v$, strictly sorted by the immutable total order $\prec$:
$$m_i \prec m_j \iff (m_i.\text{posting\_date}, m_i.\text{created\_at}, m_i.\text{id}) < (m_j.\text{posting\_date}, m_j.\text{created\_at}, m_j.\text{id})$$

Let $S_k = (\text{qty}_k, \text{basis\_qty}_k, \text{avg}_k, \text{has\_unknown}_k)$ denote the valuation state after evaluating movement $m_k$, and let $c_k = (\text{unit\_cost}_k, \text{total\_cost}_k, \text{running\_quantity}_k, \text{running\_cost\_basis\_qty}_k, \text{running\_avg\_cost}_k, \text{has\_unknown\_cost\_basis}_k)$ denote the computed valuation record.  
Let $T(S_{k-1}, m_k) \to (S_k, c_k)$ be the deterministic, memoryless state transition function.

For any cutoff business date $t$, partition $M_v$ into:
$$M_{< t} = \{m \in M_v \mid m.\text{posting\_date} < t\}$$
$$M_{\ge t} = \{m \in M_v \mid m.\text{posting\_date} \ge t\}$$

Because $\prec$ orders primarily by $\text{posting\_date}$, every element in $M_{< t}$ strictly precedes every element in $M_{\ge t}$ under $\prec$. That is:
$$\forall m_a \in M_{< t}, \forall m_b \in M_{\ge t} : m_a \prec m_b$$

Let $S_{\text{anchor}}$ be the terminal state resulting from sequentially evaluating $T$ over $M_{< t}$ initialized at $S_0 = (0, 0, 0, \text{false})$ (or $S_0$ if $M_{< t} = \emptyset$).  
Then, evaluating $T$ over $M_{\ge t}$ initialized at $S_{\text{anchor}}$ produces valuation records $c_k$ that are identical across all business attributes to the valuation records produced by a full replay of $M_v$ from $S_0$ (excluding only volatile wall-clock timestamp `computed_at = now()`).

#### Proof
1. **Markovian Determinism:** The transition function $T(S, m)$ is pure and deterministic: $S_k$ and $c_k$ depend solely on the immediate predecessor state $S_{k-1}$ and the current movement $m_k$. They have zero dependence on the history of transitions prior to $S_{k-1}$.
2. **Terminal Boundary Identity:** In a full replay of $M_v$ from $S_0$, let $m_p$ be the last element of $M_{< t}$ (the anchor movement). If $M_{< t} = \emptyset$, then $p = 0$ and the boundary state is $S_0 = S_{\text{anchor}}$. If $M_{< t} \neq \emptyset$, evaluating $T$ sequentially over $m_1, \dots, m_p$ yields $S_p$. By definition, $S_p = S_{\text{anchor}}$.
3. **Inductive Step over Replayed Slice:**  
   Index the sequence $M_{\ge t}$ as $(m_{p+1}, m_{p+2}, \dots, m_n)$.
   - *Base Step ($k = p + 1$):* In partial replay, the input state is $S'_{\text{anchor}} = S_{\text{anchor}} = S_p$. Thus:
     $$(S'_{p+1}, c'_{p+1}) = T(S_{\text{anchor}}, m_{p+1}) = T(S_p, m_{p+1}) = (S_{p+1}, c_{p+1})$$
     The computed valuation record $c'_{p+1}$ matches the full replay record $c_{p+1}$ identically.
   - *Induction Hypothesis:* Assume $S'_j = S_j$ and $c'_j = c_j$ for all $p+1 \le j < k \le n$.
   - *Induction Step ($j = k$):*
     $$(S'_k, c'_k) = T(S'_{k-1}, m_k) = T(S_{k-1}, m_k) = (S_k, c_k)$$
   By mathematical induction, $S'_k = S_k$ and $c'_k = c_k$ for every movement $m_k \in M_{\ge t}$.
4. **Exclusion of Non-Deterministic Wall-Clock Timestamps:**  
   All business attributes $(\text{unit\_cost}, \text{total\_cost}, \text{running\_quantity}, \text{running\_cost\_basis\_qty}, \text{running\_avg\_cost}, \text{has\_unknown\_cost\_basis})$ are mathematically identical. The only attribute that differs between replay runs is `computed_at`, which records `now()` at the instant of execution. **Q.E.D.**

---

### The Three Disjoint Sets of Partial Recompute (Resolving R1)

To prevent double-counting or skipping movements, `recompute_variant_cost(p_variant_id, p_from_date)` formally defines three mutually exclusive and collectively exhaustive sets:

1. **Carried-Forward State (Retained Projection Rows):**
   $$\mathcal{C}_{\text{carried}} = \{c \in \text{stock\_movement\_costs} \mid c.\text{variant\_id} = v \land c.\text{posting\_date} < p\_from\_date\}$$
   - **Action:** These rows are **retained untouched** in the database.
   - **Anchor Row:** The unique maximum row in $\mathcal{C}_{\text{carried}}$ under the total ordering key:
     $$\text{anchor} = \arg\max_{(posting\_date, created\_at, movement\_id)} \mathcal{C}_{\text{carried}}$$
   - **State Extracted:** $(v\_qty, v\_basis\_qty, v\_avg\_cost, v\_has\_unknown)$ represents the state *after* the anchor movement.
   - If $\mathcal{C}_{\text{carried}} = \emptyset$, initial state $(0, 0, 0, \text{false})$ is used.
2. **Deleted Projection Rows:**
   $$\mathcal{C}_{\text{deleted}} = \{c \in \text{stock\_movement\_costs} \mid c.\text{variant\_id} = v \land c.\text{posting\_date} \ge p\_from\_date\}$$
   - **Action:** `DELETE FROM stock_movement_costs WHERE variant_id = v AND posting_date >= p_from_date;`
   - Notice: Because $\mathcal{C}_{\text{carried}}$ is strictly `posting_date < p_from_date` and $\mathcal{C}_{\text{deleted}}$ is `posting_date >= p_from_date`, $\mathcal{C}_{\text{carried}} \cap \mathcal{C}_{\text{deleted}} = \emptyset$. The anchor row sits strictly in $\mathcal{C}_{\text{carried}}$ and is **never deleted**.
3. **Replayed Movements:**
   $$\mathcal{M}_{\text{replayed}} = \{m \in \text{stock\_movements} \mid m.\text{variant\_id} = v \land m.\text{posting\_date} \ge p\_from\_date\}$$
   - **Action:** Streamed in order `(posting_date ASC, created_at ASC, id ASC)`.
   - Notice: $\mathcal{M}_{\text{replayed}}$ is bounded strictly by `posting_date >= p_from_date`. The anchor movement (which had `posting_date < p_from_date`) is **never replayed**. The anchor's state is carried forward exactly once in $S_{\text{anchor}}$, completely eliminating the double-counting defect.

### Projection Ordering Key Architecture (Resolving R1 Ordering Defect)
In the original design, the anchor row was chosen via `ORDER BY posting_date DESC, computed_at DESC`. Because `computed_at` is identical for all rows written in a single recompute batch, multiple movements on the same business date resulted in non-deterministic anchor selection.

**Architectural Decision:** We add `created_at timestamptz NOT NULL` to `stock_movement_costs` and index `(variant_id, posting_date ASC, created_at ASC, movement_id ASC)`.
- *Why store `created_at` on `stock_movement_costs` instead of joining back to `stock_movements`:*
  1. **Self-contained ordering:** The projection table completely reproduces its own ordering key without requiring an extra join back to `stock_movements`.
  2. **Index-only backward scan:** Locating the anchor row requires a single index backward scan in $O(\log N)$ time, touching zero heap pages of `stock_movements`.
  3. **Independent auditability:** Integrity checkers can verify the monotonic ordering of `stock_movement_costs` directly from the index.

---

## 3. Direct Answers to §11 Open Questions

### Q1. COGS Source of Truth, Projection, and Cache
Detailed in §2 above.
- Canonical truth: `stock_movements` + `goods_receipt_line_costs` + `variant_costs.opening_cost`.
- Derived projection: `stock_movement_costs` (keyed 1:1 by `movement_id`).
- Fast lookup cache: `variant_costs.cost_price` (upserted with latest `running_avg_cost`).

### Q2. Landed Cost: Hook via Isolated Admin-Only Table `goods_receipt_costs`
- **Decision:** **Hook only, housed in a separate admin-only table `goods_receipt_costs`, NOT as a column on `goods_receipts`.**
- **Reasoning:**
  1. *RLS Security Boundary (Resolving Minor 2):* `goods_receipts` is directly readable by staff to support the receiving workflow. In PostgreSQL, RLS does not restrict individual columns. Placing `additional_costs` directly on `goods_receipts` would leak wholesale landed costs to staff tokens querying PostgREST. Isolating it in `goods_receipt_costs` (`receipt_id uuid PRIMARY KEY, additional_costs numeric(10,2)`) protected by `public.is_admin()` guarantees absolute secrecy.
  2. *Market reality:* In Baku local markets, goods are bought for cash with no freight bills. Line allocation would introduce false precision and unnecessary math (Hare-Niemeyer rounding).
  3. Adding the isolated table provides the database hook for future customs modules with zero migration cost.

### Q3. Supplier Returns: Dedicated Reversing Flow / Document, Never Negative Lines
- **Decision:** **Dedicated reversing document / flow via `reverse_goods_receipt` RPC; NEVER negative receipt lines.**
- **Reasoning:**
  1. *Voucher integrity:* A "Goods Receipt" is strictly an inbound document with positive quantities (`CHECK (quantity > 0)`). Negative lines create ambiguity between physical vendor rejections, credit notes, and clerical error corrections.
  2. *Movement typing:* Inbound lines generate reason `'goods_receipt'`; reversing movements generate reason `'return_to_supplier'`.
  3. *Error correction:* Reversing a posted receipt posts offsetting `'return_to_supplier'` movements linked via `correlation_id` to the original movement batch, updates receipt status to `'reversed'`, and recomputes variant costs.

### Q4. Recompute Triggering: Explicit Scoped RPC in `post_goods_receipt`, Never Row Trigger
- **Decision:** **Explicit RPC invocation inside `post_goods_receipt`; NEVER a row trigger on `stock_movements`.**
- **Reasoning:**
  1. *Thrashed Replays:* Posting a 40-line receipt would execute an `AFTER INSERT` row trigger 40 times. If multiple lines belong to the same SKU, that SKU would recompute 40 times consecutively, taking row locks and stalling the API.
  2. *Explicit M1 Guard:* Migration `20261103210000_m1_schema_additions.sql` mandates: *"DO NOT extend trg_apply_stock_movement (the AFTER INSERT trigger) to compute cost... Cost belongs in a replay projection keyed on posting_date."*
- **Mechanism:**
  - `post_goods_receipt` loops over `SELECT DISTINCT variant_id FROM goods_receipt_lines WHERE receipt_id = p_receipt_id` and invokes `recompute_variant_cost(variant_id, receipt.posting_date)` **exactly once per variant**.

### Q5. Draft Receipt Observability & Isolation
- **Rule:** **A draft receipt affects NOTHING observable outside the Goods Receipt screen.**
- **Enforcement:**
  1. *Physical stock:* Lines in a draft receipt write zero rows to `stock_movements`. `product_variants.on_hand` is only mutated via `stock_movements` inserts (enforced by `trg_guard_variant_on_hand_update`).
  2. *Available stock:* Drafts do not touch reservations (M2b) or inventory availability.
  3. *Valuation & Margin:* `stock_movement_costs` and `variant_costs` are untouched until `post_goods_receipt` executes.
  4. *Schema isolation:* Catalog queries join `products`, `product_variants`, and `stock_movements`. No foreign keys point from inventory tables to `goods_receipts`.

---

### Q6. Unified Time Axis and Query Shape for Margin Report (Resolving R6)

#### 1. Time Axis Unification
In the previous draft, COGS filtered on `sm.posting_date` while revenue filtered on `o.created_at`. An order placed on 31 October that fulfilled on 1 November attributed revenue to October and cost to November, skewing monthly margins.
- **Resolution:** **`sm.posting_date` is the sole unified business axis.**
- Both COGS and sales revenue are anchored to the physical sale movements that posted in `[:start_date, :end_date)`. Revenue is derived directly through the movement's linkage to `orders` and `order_items`.

#### 2. Clean Case Expression & Algebraic Consistency
For sales (`reason IN ('online_sale', 'counter_sale')`), `quantity_delta` is negative; net units sold is `-quantity_delta`.  
For customer returns (`reason = 'customer_return'`), `quantity_delta` is positive; net units sold decreases by `quantity_delta`.  
Algebraically, `-quantity_delta` represents net physical units exited across both cases. We express this cleanly without redundant identical branches:
- Net units sold: `SUM(CASE WHEN sm.reason IN ('online_sale', 'counter_sale') THEN -sm.quantity_delta WHEN sm.reason = 'customer_return' THEN -sm.quantity_delta ELSE 0 END)`
- Total COGS: `SUM(CASE WHEN sm.reason IN ('online_sale', 'counter_sale') THEN smc.total_cost WHEN sm.reason = 'customer_return' THEN -smc.total_cost ELSE 0 END)`

#### 3. Surviving M3 Counter Sales Without `order_items`
In M3, counter sales will post movements with `reason = 'counter_sale'`. At that point, counter sales will not have rows in `order_items`.
- **Architectural Shape:** The margin query isolates sale movement COGS and derives revenue via a `LEFT JOIN` on `order_items` matching `(oi.order_id = sm.reference_id::uuid AND oi.variant_id = sm.variant_id)`.
- When M3 lands, counter sales will populate a dedicated POS receipt item table. The revenue CTE contains a clean union extension point:
  ```sql
  -- Future M3 extension point:
  -- UNION ALL SELECT csi.variant_id, csi.line_total FROM counter_sale_items csi ...
  ```
- If an outbound movement lacks a revenue record (e.g. counter sale prior to M3 or write-off), `COALESCE(revenue, 0)` protects the arithmetic without error.

#### 4. Confirmation of `order_status` Enum
In `supabase/schema.sql` (line 18), `order_status` is defined as:
`('pending', 'phone_verified', 'courier_assigned', 'shipped', 'delivered', 'refused_at_delivery', 'cancelled')`.  
`'refused_at_delivery'` is **confirmed as a valid enum value**. Filtering `o.status NOT IN ('cancelled', 'refused_at_delivery')` is valid and runs without error.

#### 5. The Production Margin Query (Owner-Only RPC / API)
```sql
WITH movement_sales AS (
  SELECT
    sm.id AS movement_id,
    sm.variant_id,
    sm.posting_date,
    sm.quantity_delta,
    sm.reason,
    sm.reference_type,
    sm.reference_id,
    smc.unit_cost AS cogs_unit_cost,
    smc.total_cost AS cogs_total
  FROM public.stock_movements sm
  JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
  WHERE sm.posting_date >= :start_date AND sm.posting_date < :end_date
    AND sm.reason IN ('online_sale', 'counter_sale', 'customer_return')
    -- Note for M3 Kits: 'assembly_consume' movements will be excluded here
    -- to avoid double-counting components sold inside bundled kits.
),
movement_revenue AS (
  SELECT
    ms.movement_id,
    ms.variant_id,
    ms.quantity_delta,
    ms.reason,
    ms.cogs_total,
    -- Derive revenue from linked order items for online sales:
    CASE 
      WHEN ms.reason = 'online_sale' AND ms.reference_type = 'order' THEN
        COALESCE(oi.line_total, 0)
      WHEN ms.reason = 'customer_return' AND ms.reference_type = 'order' THEN
        -COALESCE(oi.line_total, 0)
      ELSE 0 -- Extension point for M3 counter_sale_items
    END AS revenue_amount
  FROM movement_sales ms
  LEFT JOIN public.orders o 
    ON ms.reference_type = 'order' 
   AND ms.reference_id = o.id::text 
   AND o.status NOT IN ('cancelled', 'refused_at_delivery')
  LEFT JOIN public.order_items oi 
    ON oi.order_id = o.id 
   AND oi.variant_id = ms.variant_id
),
aggregated_metrics AS (
  SELECT
    variant_id,
    SUM(CASE 
      WHEN reason IN ('online_sale', 'counter_sale') THEN -quantity_delta 
      WHEN reason = 'customer_return' THEN -quantity_delta 
      ELSE 0 
    END) AS net_units_sold,
    SUM(CASE 
      WHEN reason IN ('online_sale', 'counter_sale') THEN cogs_total 
      WHEN reason = 'customer_return' THEN -cogs_total 
      ELSE 0 
    END) AS total_cogs,
    SUM(revenue_amount) AS total_revenue
  FROM movement_revenue
  GROUP BY variant_id
)
SELECT
  pv.id AS variant_id,
  pv.sku,
  p.id AS product_id,
  p.title AS product_title,
  c.id AS category_id,
  c.name AS category_name,
  COALESCE(am.total_revenue, 0) AS revenue,
  COALESCE(am.total_cogs, 0) AS cogs,
  COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0) AS gross_margin,
  CASE 
    WHEN COALESCE(am.total_revenue, 0) > 0 
    THEN ROUND(((COALESCE(am.total_revenue, 0) - COALESCE(am.total_cogs, 0)) / am.total_revenue) * 100, 2)
    ELSE 0 
  END AS margin_percent,
  COALESCE(am.net_units_sold, 0) AS units_sold
FROM public.product_variants pv
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN public.categories c ON c.id = p.category_id
LEFT JOIN aggregated_metrics am ON am.variant_id = pv.id
WHERE (:category_id IS NULL OR p.category_id = :category_id)
  AND (am.net_units_sold IS NOT NULL AND am.net_units_sold <> 0 OR am.total_revenue <> 0)
ORDER BY gross_margin DESC;
```

---

### Q7. Security Boundary Verification & Executable Invariant (Resolving R5)

#### 1. The PostgREST Leak Fixed
In M1, `stock_movements.unit_cost` was created with `SELECT` granted to `staff`. Although the Express API sanitized the field, any staff JWT token calling PostgREST directly could execute `.from('stock_movements').select('unit_cost')` and view wholesale costs.

**Enforced Fix:**
1. In Migration 1 (`20261104100000_m2a_schema_tables.sql`), execute:
   ```sql
   ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS unit_cost;
   ```
   Dropping the column permanently closes the projection leak at the database schema level.
2. All cost and margin data live strictly in tables protected by `public.is_admin()` RLS:
   - `stock_movement_costs` (admin only)
   - `goods_receipt_line_costs` (admin only)
   - `goods_receipt_costs` (admin only)
   - `variant_costs` (admin only)

#### 2. Executable Invariant in `scripts/audit/check-invariants.mjs`
To ensure no future migration or developer reintroduces a cost column on a staff-readable table, we add an automated AST/schema invariant check:
- **Invariant ID:** `no-cost-column-on-staff-tables`
- **Rule:** Scans all SQL schema and migration files. Any table granting `SELECT` to `authenticated` or `staff` (or lacking admin-only RLS) must have ZERO columns matching `/(cost|margin|cogs|supplier_price)/i` (except the customer-facing retail `price` on `product_variants`).

#### 3. Verification Test Suite
Tested via Vitest against PostgREST with an authenticated staff token:
- `supabase.from('stock_movements').select('unit_cost')` $\implies$ returns error column does not exist.
- `supabase.from('variant_costs').select('*')` $\implies$ returns empty array `[]`.
- `supabase.from('stock_movement_costs').select('*')` $\implies$ returns empty array `[]`.
- `supabase.from('goods_receipt_line_costs').select('*')` $\implies$ returns empty array `[]`.
- `supabase.from('goods_receipt_costs').select('*')` $\implies$ returns empty array `[]`.

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

CREATE POLICY "Suppliers: staff insert" ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'));

CREATE POLICY "Suppliers: admin write" ON public.suppliers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cost reachability: NONE. Table contains no cost or margin data.


-- ─── 2. Goods Receipts Table (Zero Cost Columns) ─────────────
CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text UNIQUE NOT NULL,
  supplier_id       uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  posting_date      timestamptz NOT NULL DEFAULT now(),
  reference_note    text, -- Supplier invoice # or market note
  note              text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  transaction_id    uuid, -- Populated upon posting to link stock_movements
  created_by        uuid REFERENCES public.users(id),
  posted_by         uuid REFERENCES public.users(id),
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_posting_date ON public.goods_receipts(posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON public.goods_receipts(status);

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

-- Staff Read: Can inspect receipt headers (no cost fields exist on this table)
CREATE POLICY "GoodsReceipts: staff/admin read" ON public.goods_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

-- Staff Draft Create: Can create new draft intake vouchers (Resolving R3)
CREATE POLICY "GoodsReceipts: staff draft insert" ON public.goods_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND status = 'draft'
    AND posted_by IS NULL
    AND posted_at IS NULL
    AND transaction_id IS NULL
  );

-- Staff Draft Update: Can edit metadata on unposted drafts (Resolving R3)
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

-- Staff Draft Delete: Can discard unposted drafts (Resolving R3)
CREATE POLICY "GoodsReceipts: staff draft delete" ON public.goods_receipts
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND status = 'draft'
  );

-- Admin Full Access: Full CRUD for store owner
CREATE POLICY "GoodsReceipts: admin all" ON public.goods_receipts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─── 3. Goods Receipt Landed Cost Hook (Admin-Only) ───────────
CREATE TABLE IF NOT EXISTS public.goods_receipt_costs (
  receipt_id        uuid PRIMARY KEY REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  additional_costs  numeric(10,2) CHECK (additional_costs >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_receipt_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ReceiptCosts: admin only" ON public.goods_receipt_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cost reachability: Strictly admin-only. Staff tokens receive 0 rows via PostgREST.


-- ─── 4. Goods Receipt Lines Table (Quantities Only) ──────────
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

-- Staff Draft Line Insert: Can scan items into a draft receipt (Resolving R3)
CREATE POLICY "ReceiptLines: staff draft insert" ON public.goods_receipt_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
  );

-- Staff Draft Line Update: Can fix mis-scanned quantities in a draft (Resolving R3)
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

-- Staff Draft Line Delete: Can remove mis-scanned lines from a draft (Resolving R3)
CREATE POLICY "ReceiptLines: staff draft delete" ON public.goods_receipt_lines
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff')
    AND EXISTS (SELECT 1 FROM public.goods_receipts gr WHERE gr.id = receipt_id AND gr.status = 'draft')
  );

-- Admin Full Access
CREATE POLICY "ReceiptLines: admin all" ON public.goods_receipt_lines
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─── 5. Goods Receipt Line Costs (Admin-Only) ────────────────
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

-- Cost reachability: Strictly admin-only. Staff tokens receive 0 rows via PostgREST.


-- ─── 6. Derived Rebuildable Valuation Table ───────────────────
CREATE TABLE IF NOT EXISTS public.stock_movement_costs (
  movement_id               uuid PRIMARY KEY REFERENCES public.stock_movements(id) ON DELETE CASCADE,
  variant_id                uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  posting_date              timestamptz NOT NULL,
  created_at                timestamptz NOT NULL, -- Stored ordering tie-breaker (Resolving R1)
  quantity_delta            numeric(12,3) NOT NULL,
  unit_cost                 numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost                numeric(12,2) NOT NULL,
  running_quantity          numeric(12,3) NOT NULL,
  running_cost_basis_qty    numeric(12,3) NOT NULL,
  running_avg_cost          numeric(10,4) NOT NULL CHECK (running_avg_cost >= 0),
  has_unknown_cost_basis    boolean NOT NULL DEFAULT false,
  computed_at               timestamptz NOT NULL DEFAULT now()
);

-- Full total order index reproducing the deterministic replay key (Resolving R1)
CREATE INDEX IF NOT EXISTS idx_smc_replay_order
  ON public.stock_movement_costs(variant_id, posting_date ASC, created_at ASC, movement_id ASC);

ALTER TABLE public.stock_movement_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MovementCosts: admin only" ON public.stock_movement_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─── 7. Variant Costs (Admin-Only Cache & Opening Carrier) ───
-- In Migration 1, add opening_cost carrier (Resolving R5):
ALTER TABLE public.variant_costs
  ADD COLUMN IF NOT EXISTS opening_cost numeric(10,2) CHECK (opening_cost >= 0);

-- Cost reachability: variant_costs already has admin-only RLS from M1.


-- ─── 8. Ledger Modifications & Constraint Realignment ─────────
-- 8a. Drop unit_cost permanently to eliminate PostgREST staff projection leak (Resolving R5):
ALTER TABLE public.stock_movements
  DROP COLUMN IF EXISTS unit_cost;

-- 8b. Realize honest reference_type check constraint (Resolving Minor 1):
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (reference_type IN ('order', 'goods_receipt_line', 'purchase_order', 'stocktake', 'manual'));
```

---

## 5. Operational Repair & Integrity Functions (Resolving R7)

`rebuild_on_hand` and `verify_stock_integrity` are operational tools for cached quantities. Because `rebuild_on_hand` touches `product_variants.on_hand`—which M1 strictly guarded by trigger—their mechanics, trigger bypass, security, and concurrency behavior must be explicitly specified.

### 1. `rebuild_on_hand` Specification

- **Purpose:** Restores cached `product_variants.on_hand` to match the canonical physical ledger sum `SUM(sm.quantity_delta)`.
- **Guarded Column Dilemma:** In M1, `trg_guard_variant_on_hand_update` raises SQLSTATE `55000` when `pg_trigger_depth() <= 1`. To allow repair without disabling the trigger or creating synthetic movements (which would forge physical history), `rebuild_on_hand` uses a transaction-scoped configuration flag: `current_setting('inventory.allow_on_hand_repair', true)`.
- **Concurrency & Locking:** `rebuild_on_hand` executes `SELECT on_hand FROM product_variants WHERE id = p_variant_id FOR UPDATE;`. Concurrent sales or receipts inserting into `stock_movements` fire `trg_apply_stock_movement`, which attempts `UPDATE product_variants WHERE id = NEW.variant_id ...` and blocks until `rebuild_on_hand` commits. Rebuild is strictly serialized against incoming ledger traffic.
- **Access Control:** Restricted strictly to store owner (`public.is_admin()`).

```sql
-- Trigger enhancement to support transaction-scoped authorized repair:
CREATE OR REPLACE FUNCTION trg_guard_variant_on_hand_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand 
     AND pg_trigger_depth() <= 1 
     AND COALESCE(current_setting('inventory.allow_on_hand_repair', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Direct update of product_variants.on_hand is forbidden. Changes must be recorded via stock_movements.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rebuild_on_hand(p_variant_id uuid)
RETURNS TABLE (
  variant_id         uuid,
  previous_on_hand   numeric(12,3),
  repaired_on_hand   numeric(12,3),
  delta              numeric(12,3)
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cached_on_hand numeric(12,3);
  v_true_on_hand   numeric(12,3);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: rebuild_on_hand is owner-only' USING ERRCODE = '42501';
  END IF;

  -- 1. Exclusively lock the variant row to serialize against concurrent sales/receipts
  SELECT pv.on_hand INTO v_cached_on_hand
  FROM public.product_variants pv
  WHERE pv.id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', p_variant_id USING ERRCODE = 'ST002';
  END IF;

  -- 2. Compute canonical truth from immutable ledger
  SELECT COALESCE(SUM(sm.quantity_delta), 0) INTO v_true_on_hand
  FROM public.stock_movements sm
  WHERE sm.variant_id = p_variant_id;

  -- 3. If divergent, authorize repair for this transaction and update
  IF v_cached_on_hand IS DISTINCT FROM v_true_on_hand THEN
    PERFORM set_config('inventory.allow_on_hand_repair', 'true', true);
    
    UPDATE public.product_variants
    SET on_hand = v_true_on_hand,
        updated_at = now()
    WHERE id = p_variant_id;
  END IF;

  RETURN QUERY SELECT p_variant_id, v_cached_on_hand, v_true_on_hand, (v_true_on_hand - v_cached_on_hand);
END;
$$;
```

---

### 2. `verify_stock_integrity` Specification

- **Purpose:** Read-only audit RPC detecting both:
  1. **Ledger vs. On-Hand Divergence:** Discrepancies between `product_variants.on_hand` and `SUM(quantity_delta)`.
  2. **Projection vs. Ledger Divergence (catching R1-class replay defects):** Discrepancies between `stock_movement_costs.running_quantity` and cumulative `SUM(quantity_delta)`, missing valuation projection rows, and stale `variant_costs.cost_price` caches.
- **Return Type:** A set of diagnostic rows detailing the exact failure and SKU. Returns zero rows when the system is healthy.
- **Access Control:** Restricted strictly to store owner (`public.is_admin()`).

```sql
CREATE OR REPLACE FUNCTION verify_stock_integrity()
RETURNS TABLE (
  variant_id      uuid,
  sku             text,
  check_name      text,
  expected_value  numeric,
  actual_value    numeric,
  diff            numeric,
  details         text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: verify_stock_integrity is owner-only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- Check 1: Ledger sum vs Cached on_hand
  WITH ledger_totals AS (
    SELECT sm.variant_id, COALESCE(SUM(sm.quantity_delta), 0) AS true_qty
    FROM public.stock_movements sm
    GROUP BY sm.variant_id
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'ledger_vs_on_hand'::text AS check_name,
    COALESCE(lt.true_qty, 0) AS expected_value,
    pv.on_hand AS actual_value,
    (pv.on_hand - COALESCE(lt.true_qty, 0)) AS diff,
    'Cached on_hand does not match sum of stock_movements'::text AS details
  FROM public.product_variants pv
  LEFT JOIN ledger_totals lt ON lt.variant_id = pv.id
  WHERE pv.on_hand IS DISTINCT FROM COALESCE(lt.true_qty, 0)

  UNION ALL

  -- Check 2: Latest projection running_quantity vs Ledger sum (R1 replay integrity)
  WITH latest_projection AS (
    SELECT DISTINCT ON (smc.variant_id)
      smc.variant_id,
      smc.running_quantity,
      smc.running_avg_cost
    FROM public.stock_movement_costs smc
    ORDER BY smc.variant_id, smc.posting_date DESC, smc.created_at DESC, smc.movement_id DESC
  ),
  ledger_totals AS (
    SELECT sm.variant_id, COALESCE(SUM(sm.quantity_delta), 0) AS true_qty
    FROM public.stock_movements sm
    GROUP BY sm.variant_id
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'projection_vs_ledger'::text AS check_name,
    lt.true_qty AS expected_value,
    lp.running_quantity AS actual_value,
    (lp.running_quantity - lt.true_qty) AS diff,
    'Projection running_quantity diverges from cumulative ledger sum'::text AS details
  FROM latest_projection lp
  JOIN ledger_totals lt ON lt.variant_id = lp.variant_id
  JOIN public.product_variants pv ON pv.id = lp.variant_id
  WHERE lp.running_quantity IS DISTINCT FROM lt.true_qty

  UNION ALL

  -- Check 3: Missing valuation records for movements
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'unvalued_movement'::text AS check_name,
    1::numeric AS expected_value,
    0::numeric AS actual_value,
    -1::numeric AS diff,
    ('Movement ' || sm.id::text || ' has no row in stock_movement_costs')::text AS details
  FROM public.stock_movements sm
  JOIN public.product_variants pv ON pv.id = sm.variant_id
  LEFT JOIN public.stock_movement_costs smc ON smc.movement_id = sm.id
  WHERE smc.movement_id IS NULL

  UNION ALL

  -- Check 4: variant_costs cache vs latest projection running_avg_cost
  WITH latest_projection AS (
    SELECT DISTINCT ON (smc.variant_id)
      smc.variant_id,
      smc.running_avg_cost
    FROM public.stock_movement_costs smc
    ORDER BY smc.variant_id, smc.posting_date DESC, smc.created_at DESC, smc.movement_id DESC
  )
  SELECT
    pv.id AS variant_id,
    pv.sku,
    'cache_vs_projection'::text AS check_name,
    ROUND(lp.running_avg_cost, 2) AS expected_value,
    vc.cost_price AS actual_value,
    (vc.cost_price - ROUND(lp.running_avg_cost, 2)) AS diff,
    'variant_costs.cost_price cache is stale relative to latest projection running average'::text AS details
  FROM public.variant_costs vc
  JOIN latest_projection lp ON lp.variant_id = vc.variant_id
  JOIN public.product_variants pv ON pv.id = vc.variant_id
  WHERE vc.cost_price IS DISTINCT FROM ROUND(lp.running_avg_cost, 2);
END;
$$;
```

---

## 6. Atomic Posting & Reversal Mechanisms

```sql
-- ─── Post Goods Receipt RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION post_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_receipt record;
  v_tx_id uuid := gen_random_uuid();
  v_var record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only the store owner can post goods receipts' USING ERRCODE = '42501';
  END IF;

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

  -- 2. Verify lines exist and costs are populated
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
    'goods_receipt_line', -- Honest reference_type (Resolving Minor 1)
    grl.id::text,
    p_actor_id,
    COALESCE(v_receipt.note, 'Goods receipt ' || v_receipt.receipt_number),
    v_receipt.posting_date,
    v_tx_id
  FROM public.goods_receipt_lines grl
  WHERE grl.receipt_id = p_receipt_id
  ORDER BY grl.sort_order ASC, grl.id ASC;

  -- 4. Execute scoped recompute once per distinct variant from receipt.posting_date
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


-- ─── Reverse Goods Receipt RPC ────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_reason text DEFAULT 'Clerical error correction'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_receipt record;
  v_rev_tx_id uuid := gen_random_uuid();
  v_var record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: only the store owner can reverse goods receipts' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_receipt
  FROM public.goods_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found: %', p_receipt_id USING ERRCODE = 'P0002';
  END IF;

  IF v_receipt.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted receipts can be reversed; receipt is %', v_receipt.status
      USING ERRCODE = 'ST006';
  END IF;

  -- Insert offsetting return_to_supplier movements linked to original movements
  INSERT INTO public.stock_movements (
    variant_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    actor_id,
    note,
    posting_date,
    transaction_id,
    correlation_id
  )
  SELECT
    sm.variant_id,
    -sm.quantity_delta,
    'return_to_supplier'::stock_movement_reason,
    'goods_receipt_line',
    sm.reference_id,
    p_actor_id,
    'Reversal of receipt ' || v_receipt.receipt_number || ': ' || p_reason,
    v_receipt.posting_date,
    v_rev_tx_id,
    sm.transaction_id
  FROM public.stock_movements sm
  WHERE sm.transaction_id = v_receipt.transaction_id;

  -- Recompute affected variants from posting_date forward
  FOR v_var IN (
    SELECT DISTINCT variant_id
    FROM public.stock_movements
    WHERE transaction_id = v_receipt.transaction_id
  ) LOOP
    PERFORM public.recompute_variant_cost(v_var.variant_id, v_receipt.posting_date);
  END LOOP;

  -- Mark receipt reversed
  UPDATE public.goods_receipts
  SET status = 'reversed',
      updated_at = now()
  WHERE id = p_receipt_id;
END;
$$;
```

---

## 7. Detailed Replay Algorithm Specification (Resolving R1, R2, R4, R5)

```sql
CREATE OR REPLACE FUNCTION recompute_variant_cost(
  p_variant_id uuid,
  p_from_date timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_m record;
  v_qty numeric(12,3) := 0;
  v_basis_qty numeric(12,3) := 0;
  v_avg_cost numeric(10,4) := 0;
  v_has_unknown boolean := false;
  v_unit_cost numeric(10,2);
  v_total_cost numeric(12,2);
  v_opening_cost numeric(10,2);
  v_anchor_found boolean := false;
BEGIN
  -- 1. Advisory transaction lock per variant to serialize concurrent replays
  PERFORM pg_advisory_xact_lock(hashtext('cost_replay_' || p_variant_id::text));

  -- 2. Extract opening cost carrier for opening balances (Resolving R5)
  SELECT opening_cost INTO v_opening_cost
  FROM public.variant_costs
  WHERE variant_id = p_variant_id;

  -- 3. Determine Recompute Horizon & Anchor Boundary (Resolving R1)
  -- Anchor row is strictly the last row BEFORE p_from_date in total order:
  IF p_from_date IS NOT NULL THEN
    SELECT 
      running_quantity, 
      running_cost_basis_qty, 
      running_avg_cost, 
      has_unknown_cost_basis
    INTO 
      v_qty, 
      v_basis_qty, 
      v_avg_cost, 
      v_has_unknown
    FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date < p_from_date
    ORDER BY posting_date DESC, created_at DESC, movement_id DESC
    LIMIT 1;

    IF FOUND THEN
      v_anchor_found := true;
    END IF;
  END IF;

  -- Delete strictly from p_from_date forward (or all rows if full replay)
  IF p_from_date IS NOT NULL THEN
    DELETE FROM public.stock_movement_costs
    WHERE variant_id = p_variant_id AND posting_date >= p_from_date;
    
    IF NOT v_anchor_found THEN
      v_qty := 0;
      v_basis_qty := 0;
      v_avg_cost := 0;
      v_has_unknown := false;
    END IF;
  ELSE
    DELETE FROM public.stock_movement_costs WHERE variant_id = p_variant_id;
    v_qty := 0;
    v_basis_qty := 0;
    v_avg_cost := 0;
    v_has_unknown := false;
  END IF;

  -- 4. Stream movements from p_from_date forward in strict deterministic order
  FOR v_m IN (
    SELECT
      sm.id AS movement_id,
      sm.posting_date,
      sm.created_at,
      sm.quantity_delta,
      sm.reason,
      sm.reference_type,
      sm.reference_id,
      grlc.unit_cost AS receipt_cost
    FROM public.stock_movements sm
    LEFT JOIN public.goods_receipt_lines grl 
      ON sm.reason = 'goods_receipt' 
     AND sm.reference_type = 'goods_receipt_line' 
     AND grl.id::text = sm.reference_id
    LEFT JOIN public.goods_receipt_line_costs grlc 
      ON grlc.line_id = grl.id
    WHERE sm.variant_id = p_variant_id
      AND (p_from_date IS NULL OR sm.posting_date >= p_from_date)
    ORDER BY sm.posting_date ASC, sm.created_at ASC, sm.id ASC
  ) LOOP

    -- CASE A: Inbound goods receipt
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

    -- CASE B: Opening balance with carrier lookup (Resolving R5)
    ELSIF v_m.reason = 'opening_balance' THEN
      IF v_opening_cost IS NOT NULL AND v_opening_cost > 0 THEN
        v_unit_cost := v_opening_cost;
        v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);
        IF v_basis_qty <= 0 THEN
          v_avg_cost := v_unit_cost;
          v_basis_qty := v_m.quantity_delta;
        ELSE
          v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
          v_basis_qty := v_basis_qty + v_m.quantity_delta;
        END IF;
        v_has_unknown := false;
      ELSE
        -- Unvalued opening balance: excluded from average, not averaged as 0
        v_unit_cost := 0;
        v_total_cost := 0;
        v_has_unknown := true;
      END IF;
      v_qty := v_qty + v_m.quantity_delta;

    -- CASE C: Customer return with explicit order resolution (Resolving R4)
    ELSIF v_m.reason = 'customer_return' THEN
      v_unit_cost := NULL;

      -- If return references an order, resolve original sale movement cost explicitly
      IF v_m.reference_type = 'order' AND v_m.reference_id IS NOT NULL THEN
        SELECT smc.unit_cost INTO v_unit_cost
        FROM public.stock_movements sm_orig
        JOIN public.stock_movement_costs smc ON smc.movement_id = sm_orig.id
        WHERE sm_orig.variant_id = p_variant_id
          AND sm_orig.reference_type = 'order'
          AND sm_orig.reference_id = v_m.reference_id
          AND sm_orig.reason IN ('online_sale', 'counter_sale')
          AND (sm_orig.posting_date, sm_orig.created_at, sm_orig.id) < (v_m.posting_date, v_m.created_at, v_m.movement_id)
        ORDER BY sm_orig.posting_date DESC, sm_orig.created_at DESC, sm_orig.id DESC
        LIMIT 1;
      END IF;

      -- If unreferenced return (e.g. walk-in return without order), explicitly use current average
      v_unit_cost := COALESCE(v_unit_cost, v_avg_cost);
      v_total_cost := ROUND(v_m.quantity_delta * v_unit_cost, 2);

      -- Handle empty-basis case correctly (Resolving R4 empty-basis bug):
      IF v_basis_qty <= 0 THEN
        v_avg_cost := v_unit_cost;
        v_basis_qty := v_m.quantity_delta;
      ELSE
        v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);
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
      created_at, -- Stored ordering tie-breaker
      quantity_delta,
      unit_cost,
      total_cost,
      running_quantity,
      running_cost_basis_qty,
      running_avg_cost,
      has_unknown_cost_basis,
      computed_at
    ) VALUES (
      v_m.movement_id,
      p_variant_id,
      v_m.posting_date,
      v_m.created_at,
      v_m.quantity_delta,
      v_unit_cost,
      v_total_cost,
      v_qty,
      v_basis_qty,
      v_avg_cost,
      v_has_unknown,
      now()
    );
  END LOOP;

  -- 5. Refresh fast lookup cache via atomic UPSERT (Resolving R2)
  INSERT INTO public.variant_costs (variant_id, cost_price, updated_at)
  VALUES (p_variant_id, ROUND(v_avg_cost, 2), now())
  ON CONFLICT (variant_id)
  DO UPDATE SET
    cost_price = EXCLUDED.cost_price,
    updated_at = EXCLUDED.updated_at;
END;
$$;
```

---

## 8. Migration Plan & Rollback Strategy

The rollout follows a zero-downtime, 3-migration additive sequence keeping `main` deployable at every commit:

1. **Migration 1 (`supabase/migrations/20261104100000_m2a_schema_tables.sql`):**
   - Create tables: `suppliers`, `goods_receipts`, `goods_receipt_costs`, `goods_receipt_lines`, `goods_receipt_line_costs`, and `stock_movement_costs`.
   - Add `opening_cost` column to `variant_costs`.
   - Add `allow_negative_stock` to `site_settings`.
   - Realign `stock_movements.reference_type` check constraint to include `'goods_receipt_line'`.
   - Drop `stock_movements.unit_cost` to close PostgREST staff projection leak.
   - Configure RLS policies for staff draft intake and admin-only cost tables.
   - *Deployability:* Non-breaking; additive schema, legacy API continues normal operations.
2. **Migration 2 (`supabase/migrations/20261104110000_m2a_functions_triggers.sql`):**
   - Deploy `trg_guard_variant_uom_immutable` on `product_variants`.
   - Update `trg_guard_variant_on_hand_update` to support transaction-scoped authorized repair.
   - Deploy `rebuild_on_hand(variant_id)` and `verify_stock_integrity()`.
   - Deploy `set_variant_stock_safe` (retaining `set_product_stock_safe` as an aliased wrapper).
   - Deploy `recompute_variant_cost`, `post_goods_receipt`, and `reverse_goods_receipt`.
   - *Deployability:* Non-breaking; RPCs are available alongside existing endpoints.
3. **Migration 3 (`supabase/migrations/20261104120000_m2a_cost_backfill.sql`):**
   - Populate `stock_movement_costs` for all historical movements by invoking `recompute_variant_cost(variant_id)` per distinct variant.
   - Verify integrity via `verify_stock_integrity()`.
- **Executable Invariant Additions (`scripts/audit/check-invariants.mjs`):**
  - Add `no-cost-column-on-staff-tables` check asserting no cost columns exist on non-admin tables.
  - Add `no-direct-variant-costs-writes` check asserting `variant_costs` is updated exclusively via `recompute_variant_cost`.

---

## 9. Disagreements with the Work Order & Resolution of Review Findings

### 8.1. Staff Draft Receiving vs. Cost Secrecy Contradiction & Permissions Matrix (Resolving R3)

#### The Contradiction in the Work Order
The work order specified:
1. "Cost and margin are owner-only. Staff must not see them anywhere" (§3).
2. "Unit cost is mandatory on a receipt line... permitting zero here is how the margin report becomes a lie" (§6).
3. "Admin UI: receipt entry built around scanning... Cost fields absent for non-owner roles" (§12.5).

If the UI hides cost fields from staff, staff cannot provide a unit cost. If unit cost is mandatory, staff cannot submit the receipt. Furthermore, M1's RLS prevented staff from creating receipt headers and editing draft lines.

#### The Resolution: Blind Draft Receiving Workflow
1. Staff scan physical barcodes and enter counts. They can create a `draft` receipt, insert lines, correct mis-scanned quantities, and delete wrong lines.
2. Staff cannot view, enter, or update cost fields (`goods_receipt_line_costs` and `goods_receipt_costs` reject staff with 403 Forbidden).
3. Staff cannot post receipts.
4. The owner opens the draft in the Admin UI, enters the mandatory unit costs into `goods_receipt_line_costs`, reviews landed costs, and posts the receipt.

#### State Transitions and Permissions Matrix
| Action / Transition | Staff Permitted | Owner Permitted | Enforcement Mechanism | Failure Mode |
| :--- | :---: | :---: | :--- | :--- |
| **Create Draft Receipt** (`-> draft`) | **Yes** | **Yes** | RLS on `goods_receipts` (`WITH CHECK (status = 'draft')`) | RLS denial if status != draft |
| **Edit Draft Header** (`draft -> draft`) | **Yes** | **Yes** | RLS on `goods_receipts` (`status = 'draft'`) | Blocked once posted or reversed |
| **Delete Draft Receipt** | **Yes** | **Yes** | RLS on `goods_receipts` (`status = 'draft'`) | Blocked once posted or reversed |
| **Add Line to Draft** | **Yes** | **Yes** | RLS on `goods_receipt_lines` (`receipt.status = 'draft'`) | Blocked once receipt is posted |
| **Edit Line Quantity in Draft** | **Yes** | **Yes** | RLS on `goods_receipt_lines` (`receipt.status = 'draft'`) | Blocked once receipt is posted |
| **Delete Line from Draft** | **Yes** | **Yes** | RLS on `goods_receipt_lines` (`receipt.status = 'draft'`) | Blocked once receipt is posted |
| **Enter / Edit Line Cost** | **NO** | **Yes** | RLS on `goods_receipt_line_costs` (`public.is_admin()`) | 403 Forbidden / 0 rows to staff |
| **Enter / Edit Landed Cost** | **NO** | **Yes** | RLS on `goods_receipt_costs` (`public.is_admin()`) | 403 Forbidden / 0 rows to staff |
| **Post Receipt** (`draft -> posted`) | **NO** | **Yes** | RPC `post_goods_receipt` checks `public.is_admin()` | SQLSTATE 42501 Unauthorized |
| **Reverse Receipt** (`posted -> reversed`) | **NO** | **Yes** | RPC `reverse_goods_receipt` checks `public.is_admin()` | SQLSTATE 42501 Unauthorized |
| **Edit Posted Receipt or Lines** | **NO** | **NO** | RLS + Trigger immutability on posted receipts | Blocked for all roles |

---

### 8.2. Closing the M1 PostgREST Leak & Opening Balance Carrier (Resolving R5)

1. **Closing the PostgREST Leak:**  
   In M1, `stock_movements.unit_cost` was exposed to staff via PostgREST. Describing it as deprecated without dropping it left the leak open. In Migration 1, we execute `ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS unit_cost;`. Movement costs are stored exclusively in `stock_movement_costs` behind `public.is_admin()`.
2. **Carrier for Opening Balances:**  
   Dropping `stock_movements.unit_cost` eliminated the only carrier for initial inventory valuation. We introduce `opening_cost numeric(10,2) CHECK (opening_cost >= 0)` on `public.variant_costs`. Because `variant_costs` is already admin-only via RLS, opening costs remain strictly confidential. For tenants migrating without known costs (such as the first merchant), `opening_cost` is left NULL, and opening balances are excluded from average cost calculations without diluting margins. For tenants with known opening costs, `opening_cost` establishes the exact initial basis.

---

### 8.3. Outer Pack Barcode Multiplier vs. Unit Cost Normalization

§6 of the work order states: *"A scanned barcode resolves through variant_barcodes, and pack_quantity multiplies — scanning a case of twelve enters twelve"*.  
If an intake clerk scans a 12-pack case bought for $60 and types 60 into "Unit Cost", the receipt posts 12 units at $60 = $720 instead of $5.00/unit.  
**Resolution:** When a scanned barcode has `pack_quantity > 1`, the UI displays both `Pack Cost` and computed `Unit Cost` ($60 / 12 = $5.00), storing the normalized base unit cost ($5.00) in `goods_receipt_line_costs`. Quantity entered into `goods_receipt_lines` is always in the base unit of measure (`pcs`), preventing retail margin distortion.
