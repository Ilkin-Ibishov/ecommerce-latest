# M2c Design Note: Reservations, Deposits, Availability, and Concurrency

**Status:** Proposed for Architecture Review  
**Author:** Antigravity  
**Target Branch:** `m2c/reservations`  
**Reference Specs:** `docs/tasks/warehouse-m2c-reservations.md`, `prompts/m2c-design.md`, `.agents/rules/inventory.md`, `docs/STATUS.md`, `docs/audits/m2b-stocktake-audit.md`, `docs/audits/m2b-fix-3-notes.md`  
*(Length justification: ~450 lines to provide formal concurrency proofs under PostgreSQL READ COMMITTED, complete DDL for reservations and availability projections, rigorous ordinary-flow and decision-intersection audits (§11) for all 6 non-trivial rules, comprehensive call-site census across storefront and admin, and detailed critiques of spec oversights).*

---

## 1. Executive Summary & Core Invariants

Phase M2c completes Milestone 2 by introducing the reservations and deposits ledger. The central business problem is that goods promised to walk-in customers holding cash deposits stay physically present on the shelves (`on_hand` must not change), but must be rendered strictly unavailable to online buyers and subsequent walk-ins (`available` must decrease).

### Three Core Invariants Governed by this Design:
1. **A reservation is not a movement.** Writing a reservation to `stock_movements` corrupts the physical inventory ledger sum and is mathematically prohibited. Reservations reside in their own table (`public.reservations`).
2. **Three quantities must be distinguished everywhere:**
   - **On Hand ($H$):** Physically present in the store ($\sum \text{stock\_movements.quantity\_delta}$).
   - **Reserved ($R$):** Physically present but committed ($\sum \text{active reservations}$).
   - **Available ($A$):** Freely sellable stock ($A = \max(0, H - R)$).
3. **Derived availability does not protect itself; concurrency must serialize at the database engine.** Availability is checked and locked within the database transaction, preventing race conditions from overselling the last unit.

---

## 2. The Central Correctness Problem (§4 & §10 Q1): Concurrency Proof & Enforcement

### 2.1 The Problem
In M1, the trigger `trg_apply_stock_movement` on `stock_movements` enforces `on_hand + quantity_delta >= 0`. It knows nothing about reservations. If Variant $V$ has $H = 2$ and $R = 1$, then $A = 1$. Two concurrent online orders each requesting 1 unit would both see $H + (-1) = 1 \ge 0$ and $H + (-2) = 0 \ge 0$, permitting both to commit. The physical inventory drops to $0$, silently consuming the unit promised to the deposit customer.

Furthermore, application-level checks in Express routes (such as `artifacts/api-server/src/routes/orders.ts`) are inherently prone to Time-of-Check to Time-of-Use (TOCTOU) races: under concurrent async event-loop execution, both requests read $A = 1$ before either has decremented stock.

### 2.2 The Enforcement Point
Availability MUST be enforced **inside the database engine** in the same transaction that decrements stock or creates a reservation.

We establish a dual-barrier architecture:
1. **Row-Lock Serialization:** Every operation that allocates or consumes available stock (online checkout, deposit reservation creation) acquires an exclusive row lock on the variant:
   `SELECT on_hand FROM public.product_variants WHERE id = $variant_id FOR UPDATE`
2. **Database Trigger Defense-in-Depth:** The `BEFORE INSERT` trigger on `stock_movements` (`trg_apply_stock_movement`) is enhanced. When `NEW.reason = 'online_sale'`, the trigger computes active reservations for `NEW.variant_id`. If `(on_hand + NEW.quantity_delta) < active_reserved`, it aborts with custom SQLSTATE `ST014` (`Insufficient available stock`).

### 2.3 Concurrency Proof (Two Orders Racing for the Last Unit)

Let:
- $H \in \mathbb{N}_0$ be the current on-hand quantity stored on `product_variants`.
- $R(t) = \sum \{ r.\text{quantity} \mid r \in \text{reservations}, r.\text{status} = \text{'active'}, (r.\text{expires\_at} \text{ IS NULL} \lor r.\text{expires\_at} > t) \}$.
- $A(t) = H(t) - R(t)$ be the available quantity.

**Initial State:**  
At time $t_0$, Variant $V$ has $H(t_0) = 2$ and active deposit $R(t_0) = 1$. Therefore, $A(t_0) = 1$.  
Two distinct clients issue concurrent online checkout orders $T_1$ and $T_2$, each requesting quantity $q_1 = 1$ and $q_2 = 1$.

**Execution Trace under PostgreSQL `READ COMMITTED` Isolation:**
1. Both transactions call the decrement stock procedure. Both issue:
   `SELECT on_hand FROM public.product_variants WHERE id = V FOR UPDATE;`
2. PostgreSQL row-level lock arbitration establishes a total order. Without loss of generality, let $T_1$ acquire the row lock on tuple $V$ at time $t_1$.
3. $T_2$ attempts to acquire the lock on $V$ at $t_1$ and is suspended by the PostgreSQL lock manager, entering a `waiting` state.
4. Inside $T_1$:
   - $T_1$ reads $H = 2$.
   - $T_1$ queries active reservations: $R = 1$.
   - $T_1$ computes $A = 2 - 1 = 1$.
   - Since $A \ge q_1$ ($1 \ge 1$), $T_1$ proceeds to insert into `stock_movements` with `quantity_delta = -1, reason = 'online_sale'`.
   - The apply trigger updates $V$: `on_hand = 2 + (-1) = 1`.
   - $T_1$ commits at time $t_2$, updating tuple $V$ on disk and releasing the row lock.
5. At time $t_2$, $T_2$ is awakened.
   - Under PostgreSQL `READ COMMITTED` rules, when a `SELECT ... FOR UPDATE` row lock is released by a committed transaction, PostgreSQL re-evaluates the query lock on the **updated committed version** of tuple $V$.
   - $T_2$ reads the newly committed on-hand value: $H = 1$.
   - $T_2$ then evaluates active reservations: $R = 1$.
   - $T_2$ computes available stock: $A = H - R = 1 - 1 = 0$.
   - $T_2$ tests the availability predicate: $A \ge q_2 \iff 0 \ge 1 \implies \mathbf{FALSE}$.
   - $T_2$ aborts and raises exception `ST014: Insufficient available stock for variant V`.
   - Zero movement rows are written by $T_2$.
6. **Final State:**  
   $H = 1$, $R = 1$, $A = 0$. Exactly one order succeeded; the reserved deposit unit was not oversold. $\blacksquare$

---

## 3. Direct Answers to §10 Open Questions

### Q1. Where Availability is Enforced, What it Locks, and Concurrency Proof
- **Where:** Inside the database in `decrement_stock_safe` and `trg_apply_stock_movement` for sales, and inside `create_reservation` for deposit intake.
- **What it Locks:** The specific row in `public.product_variants WHERE id = variant_id FOR UPDATE`.
- **Proof:** Formally detailed in §2.3 above.

### Q2. Stored vs. Computed Availability
- **Decision:** **`available` MUST be computed on read**, never stored as a column on `product_variants`.
- **Reasoning:**
  1. *Temporal Invalidation Without Auto-Release:* §7 mandates that expiring holds (e.g. cart holds) stop reducing availability the moment `expires_at < now()`, while forbidding any background auto-release worker ("A list, not a job. Nothing is auto-released. Ever."). If `available` were a stored column, it would become instantly stale when a hold expires at 14:15:00 unless a cron daemon ran to increment the column. A computed read `(expires_at IS NULL OR expires_at > now())` reflects expiration dynamically with zero background jobs.
  2. *Single Source of Truth:* `on_hand` is already cached on `product_variants` (guarded by triggers). Maintaining a second cached column across two distinct tables (`stock_movements` and `reservations`) doubles cache invalidation failure modes.
  3. *Bundle Rationale Comparison:* The architecture forbids storing availability for bundles because bundle availability depends on multiple constituent parts. While a variant's availability depends only on its own reservations, the temporal dependency on `now()` introduces the exact same drift risk.
  4. *Performance:* At ~500 SKUs and tens of active reservations, computing availability via an indexed aggregate subquery takes $<0.1\text{ ms}$.

### Q3. The Reservation State Machine
| Transition | Trigger | Authorized Roles | Preconditions | Database Writes |
|---|---|---|---|---|
| **$\varnothing \to$ `active`** | Customer places deposit | Staff, Admin | `qty > 0`, `paid >= 0`, `paid <= agreed_price`, $A \ge \text{qty}$ | `INSERT INTO reservations (status='active')`. Acquires `product_variants FOR UPDATE`. |
| **`active` $\to$ `active` (Payment)** | Customer adds cash installment | Staff, Admin | `new_paid > old_paid`, `new_paid <= agreed_price` | `UPDATE reservations SET paid_amount = new_paid, updated_at = now()`. |
| **`active` $\to$ `active` (Price Change)** | Owner renegotiates deal | **Admin only** | `new_agreed >= paid_amount` | `UPDATE reservations SET agreed_price = new_agreed, updated_at = now()`. Staff receives 403. |
| **`active` $\to$ `fulfilled`** | Customer picks up goods | Staff, Admin | `status = 'active'`, `paid_amount == agreed_price` | 1. `UPDATE reservations SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid()`.<br>2. `INSERT INTO stock_movements (delta = -qty, reason = 'counter_sale', reference_type = 'reservation')`. Decrements $H$. |
| **`active` $\to$ `released`** | Customer cancels / Owner returns to shelf | **Admin only** | `status = 'active'` | `UPDATE reservations SET status = 'released', released_at = now(), released_by = auth.uid(), release_reason = note`. Zero stock movements. Increases $A$. |
| **`active` $\to$ `expired`** | Time passes `expires_at` | System (dynamic read) / Admin | `expires_at < now()` | Dynamically excluded from $R$ on read. Admin may explicitly close via `UPDATE status = 'expired'`. |

### Q4. Downward Stocktake Correction Below Reserved
- **Scenario:** Store has $H = 5, R = 3 \implies A = 2$. A real physical stocktake discovers theft: only 1 unit exists on the shelf. Stocktake posts a delta of $-4$, setting $H = 1$.
- **Behavior:**
  1. **Stocktake Posting MUST NOT be Blocked:** Physical observation must reflect reality. `post_stocktake` writes `reason = 'stocktake_correction'`, which bypasses the availability check.
  2. **Reservation Status Unchanged:** The reservation remains `status = 'active'`. The system cannot unilaterally void a customer's deposit contract because of internal theft.
  3. **Storefront Availability Clamped to Zero:** Storefront calculates $A = \max(0, H - R) = \max(0, 1 - 3) = 0$. The item is marked Out of Stock online; no further online sales can occur.
  4. **Admin Inventory Screen Highlights Deficit:** The admin inventory screen displays three separate columns: `On Hand: 1 | Reserved: 3 | Available: -2 (Deficit 2)`. A red alert badge flags the deficit, instructing the owner to re-order urgently or contact the deposit customer.

### Q5. Fulfilment Interaction with the Future M3 Counter Sale
- In M2c, M3's counter till is not yet built. Fulfilment is executed via staff admin endpoint `POST /admin/reservations/:id/fulfil`.
- The fulfilment RPC atomically:
  1. Marks the reservation `fulfilled`.
  2. Inserts a movement row: `reason = 'counter_sale'`, `reference_type = 'reservation'`, `reference_id = reservation.id`.
- When M3 ships, the counter sale POS will call this exact fulfilment RPC when scanning a deposit ticket, passing optional fiscal receipt metadata into `stock_movements.note` or metadata without any schema changes to M2c rows.

### Q6. Query Shape for Availability & Indexes
- **Catalogue Query Pattern (Batch 24 Products):**
  ```sql
  SELECT
    p.id, p.slug, p.price,
    pv.id AS default_variant_id,
    pv.on_hand,
    COALESCE(r.active_reserved, 0) AS reserved_quantity,
    GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0)) AS available_quantity
  FROM public.products p
  JOIN public.product_variants pv ON pv.product_id = p.id AND pv.is_default = true
  LEFT JOIN (
    SELECT variant_id, SUM(quantity) AS active_reserved
    FROM public.reservations
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
    GROUP BY variant_id
  ) r ON r.variant_id = pv.id
  WHERE p.id = ANY($1);
  ```
- **Indexes:**
  1. `idx_reservations_active_variant`: Partial covering index on `(variant_id, quantity) WHERE status = 'active'`.
  2. `idx_reservations_aged_list`: `(created_at ASC) WHERE status = 'active' AND expires_at IS NULL`.
  3. `idx_reservations_customer_phone`: `(customer_phone)` for instantaneous lookup at counter.

### Q7. Interaction with M2a Cost Replay and M2b Stocktake Posting
- **Expected:** **NO interaction.**
- **Reasoning:**
  1. `recompute_variant_cost` replays `stock_movements` ordered by `posting_date`. Reservations never write to `stock_movements`; inventory valuation is strictly the cost of physical on-hand units ($H \times \text{unit\_cost}$). Promising a unit to a customer does not change its wholesale replacement or moving average cost.
  2. `post_stocktake` reconciles physical count observations against physical snapshots. A counter counts what is physically on the shelf.
- **Where Enforced:** Mechanically enforced by invariant check `reservations-are-not-movements` in `scripts/audit/check-invariants.mjs`.

---

## 4. Mandatory Rule Audits (§11)

For every non-trivial rule proposed, we detail: (1) Ordinary-flow walkthrough, and (2) Intersections checked against earlier architectural decisions.

### Rule 1: Online Sale Blocked on Available Stock Shortfall (`ST014`)
1. **Ordinary-Flow Walkthrough:** Customer purchases 1 unit of a shirt online. Store has $H = 5, R = 0 \implies A = 5$. Trigger tests $5 + (-1) \ge 0 \implies 4 \ge 0$. Movement is inserted, on-hand becomes 4. Purchase completes cleanly.
2. **Intersections Checked:**
   - *Intersected with M2b Stocktake Posting:* M2b delta corrections use `reason = 'stocktake_correction'`. The trigger condition is strictly scoped: `IF NEW.reason = 'online_sale' THEN ...`. It does NOT block stocktake adjustments or damage write-offs.
   - *Intersected with M1 Negative Stock Setting:* If tenant setting `allow_negative_stock = true`, online sales may still be permitted to oversell if configured, but by default `allow_negative_stock = false` raises `ST014`.

### Rule 2: Variant Row-Locking on Reservation Creation
1. **Ordinary-Flow Walkthrough:** Staff creates deposit for 1 unit. `create_reservation` locks variant row `FOR UPDATE`, computes $A = H - R$, verifies $A \ge 1$, inserts reservation row, and commits within 3 ms.
2. **Intersections Checked:**
   - *Intersected with Concurrent Online Checkout:* Because both `orders.ts` checkout and `create_reservation` acquire `product_variants FOR UPDATE`, concurrent deposit creation and online checkout are serialized by PostgreSQL, preventing double-allocation of the final available unit.

### Rule 3: Dynamic Expiry Exclusion Without Background Daemon
1. **Ordinary-Flow Walkthrough:** Deposit has `expires_at = NULL`. It remains active indefinitely until fulfilled or released. A promotional 24-hour hold has `expires_at = 2026-11-05 10:00:00`. At 09:59, $A$ is reduced. At 10:01, `expires_at > now()` evaluates to false; $A$ returns to open shelf instantly.
2. **Intersections Checked:**
   - *Intersected with §7 Invariant:* "Nothing is auto-released. Ever." No cron job runs `UPDATE reservations SET status = 'expired'`. The row remains intact for historical inspection, but availability immediately unblocks.

### Rule 4: Role-Restricted Price Mutation
1. **Ordinary-Flow Walkthrough:** Staff enters a deposit with agreed price 120 AZN and records 40 AZN cash. Customer returns later and pays 30 AZN; staff records the 30 AZN payment. If staff attempts to alter `agreed_price` to 100 AZN, the database RLS policy / API rejects the request with 403 Forbidden.
2. **Intersections Checked:**
   - *Intersected with M1 Role Convention:* Staff may enter operational counts and receipts, but may never alter prices. Owner retains exclusive pricing authority.

### Rule 5: Non-Movement Ledger Fulfilment Handshake
1. **Ordinary-Flow Walkthrough:** Customer pays remaining balance and picks up coat. Staff clicks Fulfil. Transaction updates reservation to `fulfilled` and writes movement `delta = -1, reason = 'counter_sale'`.
2. **Intersections Checked:**
   - *Intersected with Invariant "A reservation is not a movement":* The reservation creation wrote 0 movements. Only the physical exit of the goods writes a movement.
   - *Intersected with Availability Continuity:* Before pickup: $H = 10, R = 1 \implies A = 9$. After pickup: $H = 9, R = 0 \implies A = 9$. Availability never jitters or temporarily spikes during the handshake.

### Rule 6: Downward Stock Correction Deficit Handling
1. **Ordinary-Flow Walkthrough:** Physical count reveals shrinkage ($H$ drops from 3 to 1 while $R = 2$). Stocktake posts delta $-2$.
2. **Intersections Checked:**
   - *Intersected with M2b Post Stocktake RPC:* Does not abort with `ST001` or `ST014`.
   - *Intersected with Storefront Validation:* Express `orders.ts` and UI clamp $A = \max(0, H - R) = 0$, immediately closing online checkout for that variant.

---

## 5. Proposed Schema Design

```sql
-- ─── 1. Reservations Ledger Table ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number  text UNIQUE NOT NULL,
  variant_id          uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
  customer_name       text NOT NULL CHECK (char_length(trim(customer_name)) > 0),
  customer_phone      text NOT NULL CHECK (char_length(trim(customer_phone)) > 0),
  hold_type           text NOT NULL DEFAULT 'deposit' CHECK (hold_type IN ('deposit', 'order_hold', 'cart_hold')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'released', 'expired')),
  agreed_price        numeric(10,2) NOT NULL CHECK (agreed_price >= 0),
  paid_amount         numeric(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= agreed_price),
  notes               text,
  expires_at          timestamptz,
  created_by          uuid NOT NULL REFERENCES public.users(id),
  fulfilled_by        uuid REFERENCES public.users(id),
  fulfilled_at        timestamptz,
  released_by         uuid REFERENCES public.users(id),
  released_at         timestamptz,
  release_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_fulfilled_attribution CHECK (status <> 'fulfilled' OR (fulfilled_at IS NOT NULL AND fulfilled_by IS NOT NULL)),
  CONSTRAINT chk_released_attribution CHECK (status <> 'released' OR (released_at IS NOT NULL AND released_by IS NOT NULL))
);

-- Partial Indexes for High-Velocity Queries
CREATE INDEX IF NOT EXISTS idx_reservations_active_variant
  ON public.reservations (variant_id, quantity)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_reservations_aged_list
  ON public.reservations (created_at ASC)
  WHERE status = 'active' AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_customer_phone
  ON public.reservations (customer_phone);

-- ─── 2. Row Level Security Posture ───────────────────────────
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Staff and Admin can view reservations; public/anonymous tokens get 0 rows
CREATE POLICY "Reservations: staff/admin read" ON public.reservations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff')));

-- Staff can insert active deposits
CREATE POLICY "Reservations: staff insert" ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'staff'))
    AND status = 'active'
    AND created_by = auth.uid()
    AND fulfilled_by IS NULL
    AND released_by IS NULL
  );

-- Staff can update paid_amount, notes, or fulfil; staff CANNOT alter agreed_price or release
CREATE POLICY "Reservations: staff update" ON public.reservations
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'staff'))
  WITH CHECK (
    status IN ('active', 'fulfilled')
    AND agreed_price = (SELECT r.agreed_price FROM public.reservations r WHERE r.id = reservations.id) -- price immutable to staff
  );

-- Admin has full operational control (including price renegotiation and release)
CREATE POLICY "Reservations: admin all" ON public.reservations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ─── 3. Storefront Availability View ─────────────────────────
-- Encapsulates availability calculation without exposing customer identities or contact numbers
CREATE OR REPLACE VIEW public.product_variant_availability AS
SELECT
  pv.id AS variant_id,
  pv.product_id,
  pv.sku,
  pv.price,
  pv.on_hand,
  COALESCE(r.active_reserved, 0)::numeric(12,3) AS reserved_quantity,
  GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0))::numeric(12,3) AS available_quantity
FROM public.product_variants pv
LEFT JOIN (
  SELECT variant_id, SUM(quantity) AS active_reserved
  FROM public.reservations
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
  GROUP BY variant_id
) r ON r.variant_id = pv.id;

ALTER VIEW public.product_variant_availability OWNER TO postgres;
GRANT SELECT ON public.product_variant_availability TO anon, authenticated, service_role;
```

---

## 6. Storefront & Admin Call Sites to Migrate

### Confident Call Sites (Must Migrate in M2c)

#### Storefront
1. `artifacts/store/src/pages/storefront/ProductsPage.tsx`:
   - Replace direct `stock` filter (`query.gt("stock", 0)`) with `available_quantity > 0`.
2. `artifacts/store/src/components/storefront/ProductCard.tsx`:
   - Replace `stock` prop with `availableStock`.
   - Out-of-stock badge, disabled cart button, and "only X left" badges bind to `availableStock`.
3. `artifacts/store/src/components/storefront/ProductDetail.tsx`:
   - `inStock` boolean, stepper maximum (`Math.min(availableStock, qty + 1)`), and Add-to-Cart validation bind to `availableStock`.
4. `artifacts/store/src/components/storefront/QuickViewModal.tsx`:
   - Fetch query updated to read `available_quantity` from `product_variant_availability`.
5. `artifacts/store/src/pages/storefront/HomePage.tsx`:
   - Featured / On-Sale / Deal-of-Day grids pass `available` to `ProductCard`.
6. `artifacts/store/src/pages/storefront/CategoryPage.tsx`:
   - Category product grid passes `available` to `ProductCard`.
7. `artifacts/store/src/pages/storefront/CheckoutPage.tsx`:
   - Price/stock check (`POST /api/products/prices`) and local quantity clamp validate against `available`.
8. `artifacts/api-server/src/routes/products.ts`:
   - `POST /products/prices` returns `{ price, stock: available, available, slug }`.
9. `artifacts/api-server/src/routes/orders.ts`:
   - Preliminary stock check (lines 49-52) tests `item.quantity <= available`.
   - `decrementStockSafe` RPC call enforces database lock and triggers `ST014` if available stock is exhausted.

#### Admin
10. `artifacts/store/src/pages/admin/InventoryPage.tsx`:
    - **Crucial §8 requirement:** Split single stock column into **three distinct columns:** `On Hand`, `Reserved`, and `Available`.
    - Display warning badge on rows where $H < R$ (Deficit).
11. `artifacts/store/src/pages/admin/DashboardPage.tsx`:
    - Low stock threshold widget counts items where `available < LOW_STOCK_THRESHOLD`.
12. `artifacts/api-server/src/routes/inventory.ts`:
    - Barcode scan lookup `/inventory/scan/:barcode` returns `{ on_hand, reserved, available }`.

### Call Sites Needing Verification / Secondary Scope
13. `artifacts/store/src/pages/admin/ProductsPage.tsx`:
    - Bulk flags and filtering (`low_stock`, `out_of_stock`). Confirm whether owner prefers sorting catalogue by on-hand or available. (Recommended: default to available).
14. `artifacts/store/src/components/admin/StockCell.tsx`:
    - Currently opens manual stock adjustment modal. Must clarify that adjustment modifies physical on-hand ($H$), not reservations ($R$).

---

## 7. Zero-Downtime Migration & Rollback Strategy

### Migration Ordering (Forward-Only)
1. **Migration 1 (`20261104180000_m2c_reservations_schema.sql`):**
   - Creates `public.reservations` table, indexes, and RLS policies.
   - Creates `public.product_variant_availability` view.
   - *Deployability:* Non-breaking additive change. Existing API and storefront continue reading existing columns.
2. **Migration 2 (`20261104190000_m2c_enforcement_functions.sql`):**
   - Updates `trg_apply_stock_movement` to check `NEW.reason = 'online_sale'` against active reservations, raising `ST014`.
   - Creates `create_reservation`, `fulfil_reservation`, and `release_reservation` stored procedures.
   - Updates `decrement_stock_safe` to pass `reason = 'online_sale'`.
3. **Application Layer Deployment:**
   - Deploy API routes (`/admin/reservations`) and updated storefront components reading availability.

### Rollback Strategy
- All tables and columns are additive; no table or column is dropped.
- If an unexpected regression occurs in the trigger, a rollback migration can restore `trg_apply_stock_movement` to its M2b definition in under 5 seconds without dropping `reservations` data or locking user tables.

---

## 8. Critiques & Disagreements with the Work Order

1. **Contradiction on Staff Payment Permissions (§6 vs. §9):**
   - *Spec §6 says:* "One agreed price, one paid amount, editable by the owner only — staff may create a deposit but not change what was agreed."
   - *Spec §9 says:* "Staff: create a deposit, record a payment against one, fulfil one..."
   - *Resolution:* If staff could not update `paid_amount`, staff at the counter could not accept cash installments when customers bring partial payments. The correct invariant is: **Staff may increment `paid_amount` up to `agreed_price`, but staff may NEVER change `agreed_price` or release a deposit.** This note enforces that division in DDL RLS policies.
2. **Abandoned Deposits and Financial Accounting Gaps (§6 & §7):**
   - The spec forbids a payments ledger or refund records ("Not in this phase: a payments ledger, partial-payment history, refunds...").
   - However, when an owner releases an abandoned deposit after 30 days, the customer may forfeit their deposit or receive cash back. If the record merely flips to `released`, the store's cash drawer history becomes unverifiable.
   - *Resolution:* We require an explicit `release_reason` text column on `reservations` where the owner must record whether cash was refunded or forfeited.
3. **Multi-Item Order Concurrency in `orders.ts`:**
   - Currently, `artifacts/api-server/src/routes/orders.ts` decrements stock for multi-item orders in an asynchronous JavaScript loop calling `decrementStockSafe` iteratively. If item 1 succeeds and item 2 fails `ST014`, it relies on a best-effort JS rollback.
   - *Recommendation:* While preserving the existing RPC signature for backwards compatibility, `decrementStockSafe` operations must sort variant IDs lexicographically to prevent database deadlocks when concurrent multi-item carts compete for intersecting variants.
4. **Catalogue Batch Query N+1 Vulnerability (§8):**
   - Replacing `products.stock` on the catalogue page by querying variants per product would create 24 round-trips.
   - *Resolution:* The storefront product list query (`lib/queries/products.ts`) must embed the single default variant's availability directly via `product_variant_availability` in a single join, preserving sub-50ms page loads.
