# Design Note: `counter_sale_payments`

> **Status:** Proposed for coordinator and architectural review.  
> **Author:** `@payments` (builder)  
> **Date:** 2026-11-13  
> **Branch:** `chore/counter-sale-payments`  
> **Spec Reference:** `docs/tasks/chore-counter-sale-payments.md`  
> **Architectural Decisions:** `docs/tasks/warehouse-m3-section-16-decisions.md` §16.4  

---

## 1. Executive Summary & Goal

In retail point-of-sale systems, recording money taken at the till as a single flat column (`counter_sales.payment_method`) is an architectural anti-pattern that creates significant technical debt when multi-tender capability is introduced. As detailed in §16.4, converting a single-tender schema to split tender after launch requires breaking migrations, retrofitting child tables, and rewriting every downstream report, audit log, and cash-drawer reconciliation view.

This chore implements the **data model and schema foundation** for multi-tender settlement:
1. Replaces the single payment method column concept with child settlement records in `public.counter_sale_payments` (`sale_id`, `method`, `amount`).
2. Introduces an extensible lookup table `public.payment_methods` (lookup table, not a rigid Postgres enum).
3. The till still writes exactly **one** settlement row per sale in this phase.
4. Enforces settlement sum balance at transaction commit via a deferred constraint trigger (`sum(amount) = counter_sales.total_amount`).
5. Guarantees physical append-only row immutability on settlement records via both engine-level triggers and RLS/privilege revocations.
6. Backfills all existing `counter_sales` rows into `counter_sale_payments` without disrupting voided sales or margin reporting.
7. Keeps `counter_sales.payment_method` as a deprecated compatibility column, writing both atomically in `post_counter_sale` so that no frontend pages, API contracts, or generated types break.

---

## 2. Schema Specification

The migration sequence follows repository conventions (`supabase/migrations/timestamp_concern.sql`), with one distinct concern per file after `20261111120800`:

### 2.1 Lookup Table: `payment_methods`
- **File:** `supabase/migrations/20261113230100_payment_methods.sql`
- **Why a table, not an enum?** Per §16.4, payment methods in retail evolve with regional practices and customer demands (e.g., local debit schemes, QR payments, store credit, vouchers). In PostgreSQL, modifying an enum requires `ALTER TYPE`, which takes exclusive catalog locks and cannot be deactivated or annotated without complex migrations. A table allows soft-deactivation (`active = false`), foreign keys with referential integrity, and runtime lookups.
- **DDL:**
```sql
CREATE TABLE IF NOT EXISTS public.payment_methods (
  code text PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.payment_methods (code, label, active) VALUES
  ('cash', 'Cash', true),
  ('card', 'Card', true),
  ('bank_transfer', 'Bank Transfer', true),
  ('other', 'Other', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PaymentMethods: staff/admin read" ON public.payment_methods
  FOR SELECT TO authenticated USING (true);
```
- **Grants:** Read-only for authenticated users. All client writes (`INSERT`, `UPDATE`, `DELETE`) are denied.

### 2.2 Settlement Table: `counter_sale_payments`
- **File:** `supabase/migrations/20261113230200_counter_sale_payments.sql`
- **Primary Key:** `(sale_id, method)`. In this phase, each tender method can appear at most once per sale.
- **Zero-amount legality:** Zero amounts (`amount = 0.00`) are explicitly permitted because 100% bundle or promotional discounts can yield `total_amount = 0.00`.
- **DDL:**
```sql
CREATE TABLE IF NOT EXISTS public.counter_sale_payments (
  sale_id uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE RESTRICT,
  method text NOT NULL REFERENCES public.payment_methods(code),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_id, method)
);

CREATE INDEX IF NOT EXISTS idx_counter_sale_payments_method
  ON public.counter_sale_payments (method);

ALTER TABLE public.counter_sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CounterSalePayments: admin read" ON public.counter_sale_payments
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON public.counter_sale_payments FROM public, anon, authenticated;
GRANT SELECT ON public.counter_sale_payments TO authenticated;
GRANT ALL ON public.counter_sale_payments TO service_role;
```

---

## 3. Sum Constraint & Integrity Enforcement

Per spec §3.3, the sum of settlement rows must equal the sale total (`counter_sales.total_amount`). Furthermore, a sale with zero payment rows is invalid, because every counter sale (even `needs_owner`) is a paid sale at the till.

### 3.1 Constraint Trigger Mechanism
A standard check constraint or immediate trigger cannot validate split-tender legs inserted sequentially. Therefore, validation is implemented via a **`DEFERRABLE INITIALLY DEFERRED`** constraint trigger:
- At transaction commit, PostgreSQL evaluates `chk_counter_sale_payments_sum()`.
- If `COALESCE((SELECT sum(amount) FROM public.counter_sale_payments WHERE sale_id = target_sale_id), 0) <> total_amount`, the transaction rolls back with error code `ST027` (`Payment sum does not equal sale total`).

### 3.2 Dual-Table Constraint Coverage (Proposed Improvement)
A constraint trigger only placed on `counter_sale_payments` fires when payment rows are touched. If a flawed or malicious transaction inserts a row into `counter_sales` without inserting *any* payment rows, a trigger on `counter_sale_payments` alone would never fire.
To ensure total integrity:
1. `counter_sale_payments`: constraint trigger on `INSERT`, `UPDATE`, `DELETE` (`DEFERRABLE INITIALLY DEFERRED`).
2. `counter_sales`: constraint trigger on `INSERT`, `UPDATE` (`DEFERRABLE INITIALLY DEFERRED`) checking that `(SELECT COALESCE(sum(amount), 0) FROM public.counter_sale_payments WHERE sale_id = NEW.id) = NEW.total_amount` AND `EXISTS (SELECT 1 FROM public.counter_sale_payments WHERE sale_id = NEW.id)`.
This guarantees that an unpaid counter sale cannot commit under any circumstances.

---

## 4. Row Immutability: Trigger vs. Grant

Spec §3.4 requires explaining how row immutability is enforced on `counter_sale_payments` and why.

### 4.1 Evaluation of Options
1. **Grant Revocation Alone:**
   - Revoking `UPDATE` and `DELETE` privileges from `anon` and `authenticated` roles stops direct client modifications through PostgREST.
   - *Limitation:* The backend API server connects with `service_role`, which bypasses RLS and holds table owner permissions. Similarly, internal migrations and database functions run with elevated privileges. If application code or a maintenance query accidentally executes `UPDATE counter_sale_payments` or `DELETE FROM counter_sale_payments`, privilege revocation provides no defense.
2. **Trigger-Based Immutability:**
   - A `BEFORE UPDATE OR DELETE` row trigger (`trg_counter_sale_payments_immutable()`) executes for *all* connections and roles, unconditionally raising an exception (e.g. `RAISE EXCEPTION 'counter_sale_payments is immutable: updates and deletes are forbidden' USING ERRCODE = '2BP01'`).
   - This matches the pattern established in M1 for `stock_movements` (`trg_stock_movements_immutable()` in `20261102100000_m1_variants_ledger.sql`).

### 4.2 Decision
**Use both (Defense in Depth):**
- A `BEFORE UPDATE OR DELETE` trigger `trg_counter_sale_payments_immutable()` enforces absolute ledger immutability at the engine level for all callers, including `service_role`.
- RLS and privilege management restrict direct client access, granting `SELECT` to `authenticated` (filtered by `is_admin()`) and denying `INSERT`, `UPDATE`, and `DELETE` to client roles.

---

## 5. Recommendation on `counter_sales.payment_method` (Spec §4)

Spec §4 asks whether to keep or drop `counter_sales.payment_method` during this chore:

### 5.1 Analysis
- **Current Readers:**
  - Frontend: `CounterPage.tsx`, `CounterReceiptPage.tsx`, `CounterSalesPage.tsx`.
  - Backend: `artifacts/api-server/src/routes/admin/counter-sales.ts` (lists and detail queries).
  - Types: `artifacts/supabase-types/src/database.types.ts`.
  - Tests: `artifacts/api-server/tests/m3-counter-sales.integration.test.ts` (and related test suites).
- **If dropped now:**
  - Would require modifying the Express admin router to perform an outer join or subquery on `counter_sale_payments` to reconstruct the legacy field.
  - Would require regenerating or manually patching `database.types.ts`.
  - Expands the blast radius of this backend schema chore into UI and routing components.
- **If kept (as specified):**
  - Inside `post_counter_sale`, both `counter_sales.payment_method` and `counter_sale_payments.method` are written atomically from `p_sale->>'payment_method'` in the exact same transaction.
  - The two columns cannot drift or disagree by construction.
  - Zero breaking changes to client pages, API endpoints, or test fixtures.
  - Marked deprecated in the migration comment:
    `COMMENT ON COLUMN public.counter_sales.payment_method IS 'DEPRECATED: Preserved for read compatibility; authoritative tender settlements live in counter_sale_payments.';`

### 5.2 Recommendation
**Keep `counter_sales.payment_method` for this chore**, exactly as decided by the architect in §4. Dropping the column and converting the UI/API readers to multi-tender belongs in the subsequent multi-tender UI phase.

---

## 6. The Two Rules from §16.4

### 6.1 Lock the Sale Before Payment; Never Modify Lines or Prices After
- **How it holds:** In `post_counter_sale`, lines are priced and inserted, variant rows are locked `FOR UPDATE`, and then the payment row is inserted in the **same single transaction** prior to commit. The sale is created and settled in an atomic operation.
- **Separate Lock Necessity:** No separate locking primitive or row-version check is needed today because payment capture and sale posting are synchronous.
- **Future Split Tender / Partial Payments:** If a future workflow allows partial payments over time before a sale is completed, a dedicated `add_counter_sale_payment(p_sale_id, ...)` function would be required. That function would need to execute `SELECT status, total_amount FROM public.counter_sales WHERE id = p_sale_id FOR UPDATE` before writing the payment row, explicitly verifying that lines and pricing are locked against changes.

### 6.2 Refund Settles Against Original Tenders, Per Leg
- `void_counter_sale` remains status-based (`status = 'voided'`), creating compensating stock movements for posted sales.
- No negative or reversing rows are inserted into `counter_sale_payments`.
- The original settlement rows in `counter_sale_payments` serve as the immutable record of tender collected, defining the exact tender methods and amounts to be refunded to the customer.

---

## 7. Deposit Pick-Ups & The Day-End Count (Spec §5a)

### 7.1 Current Code Reality
- `fulfil_reservation(p_reservation_id, p_actor_id, p_final_payment numeric)` accepts only an amount, with no method parameter.
- `PickupPanel.tsx` in the admin UI collects the remaining balance without a tender method selector.
- A pick-up operation is linked to `reservations.id`, not `counter_sales.id`, and `counter_sale_payments` requires a foreign key to `counter_sales.id`.
- The initial deposit (`reservations.paid_amount`) was also captured without an associated tender method.

### 7.2 What the Day-End Reconciliation Misses
Until a dedicated chore extends deposit pick-ups with tender methods and settlement records:
1. **Drawer Cash Discrepancy:** Any final payment collected in cash at the till during reservation collection physically enters the cash drawer, but will **not** appear in cash settlement queries against `counter_sale_payments`.
2. **Card Terminal Discrepancy:** Similarly, card balances settled at collection time will be absent from daily card settlement totals.
3. **Reconciliation Scope:** Day-end cash drawer counts based on `counter_sale_payments` will only balance pure counter sales. Cash collected from reservation pick-ups must continue to be reconciled separately via reservation audit records until unified till settlement is implemented.

---

## 8. Answers to Spec §8 Intersections

Every intersection from spec §8 is addressed below with its ordinary-flow behavior and earlier architectural decision:

### 8.1 `post_pending_counter_sale` (Owner Resolves `needs_owner` Sale)
- **Ordinary-Flow Behavior:** When a sale enters `needs_owner` due to an on-hand stock guard refusal (`ST001`), the header, lines, and payment row were already written during the initial `post_counter_sale` invocation. When the owner fixes physical inventory and calls `post_pending_counter_sale(p_id, p_session_user)`, the function only locks variants, writes the pending stock movements, updates stocktake flags, and transitions status to `posted`. **It writes zero payment rows.**
- **Earlier Decision Met:** M3 spec §4 ("Every counter sale, including needs_owner, is a paid sale; the till never loses a paid sale") and §16.4. The customer paid at the till; resolving the stock deficit does not alter the money taken.

### 8.2 `void_counter_sale` on a `needs_owner` Sale
- **Ordinary-Flow Behavior:** Calling `void_counter_sale` on a `needs_owner` sale sets `status = 'voided'`, records `voided_by`, `voided_at`, and `void_reason`. Because no stock movements ever existed for `needs_owner`, no compensating movements are generated. `counter_sale_payments` rows are **not deleted or updated**; they remain intact.
- **Earlier Decision Met:** Meets §16.4 ("A refund settles against the original tenders, per leg") and M3 design note Q5 ("A needs_owner sale has no movements and only changes status. Nothing is edited or deleted in the ledger"). Preserving the payment row allows staff to see exactly which tender was taken and must be refunded.

### 8.3 Idempotent Replay & `ON CONFLICT` Race Path in `post_counter_sale`
- **Ordinary-Flow Behavior:**
  1. *Sequential Replay:* In step 1 of `post_counter_sale`, if `id` exists with matching `payload_hash`, the function immediately returns `public.counter_sale_json(v_id) || jsonb_build_object('replayed', true)` and exits. The payment insert is never reached.
  2. *Concurrent Race:* In step 4, `INSERT INTO counter_sales ... ON CONFLICT (id) DO NOTHING` handles concurrent racing requests with the same `id`. If `v_inserted = 0`, the function checks hash equality and returns `replayed: true` immediately, skipping line and payment insertion.
  3. Consequently, payment row insertion is executed exactly once in the winning transaction.
- **Earlier Decision Met:** Meets M3 spec §6 idempotency requirement.

### 8.4 Backfill and the Margin Report
- **Ordinary-Flow Behavior:** The backfill populates `counter_sale_payments` for every historical sale (`INSERT ... SELECT id, payment_method, total_amount, created_at FROM counter_sales`). The margin report (`20261111120700_m3_margin_report_counter_revenue.sql` and `20261111120800_margin_report_live_schema.sql`) computes counter revenue by joining `stock_movements.transaction_id = counter_sales.id` and summing line totals or `counter_sales.total_amount`. It does not query `counter_sale_payments`.
- **Earlier Decision Met:** Meets M3 §10 / design note Q6. Revenue is a property of the sale document, whereas payments represent settlement tenders. Backfilling payments has zero impact on margin reporting.

### 8.5 Pre-M3 Rows and Deferred Sum Check
- **Ordinary-Flow Behavior:** All rows in `counter_sales` originated under M3 (the table did not exist prior to `20261111120300_m3_counter_sales.sql`). All rows have `total_amount >= 0` and a non-null `payment_method`. Backfilling each sale with `amount = total_amount` means `sum(amount) = total_amount` holds with 100% mathematical certainty. Voided sales retain their original `total_amount`, so their backfilled payment rows also balance. Zero-dollar sales (e.g., full discounts) backfill with `amount = 0.00`, which satisfies `amount >= 0` and `sum(amount) = 0.00`.
- **Earlier Decision Met:** Meets spec §3.3 and §3.5: the backfill succeeds cleanly across all sales of every status and satisfies the deferred sum check.

---

## 9. Backfill Strategy

- **File:** `supabase/migrations/20261113230300_counter_sale_payments_backfill.sql`
- **Re-runnability:** Uses `ON CONFLICT (sale_id, method) DO NOTHING`.
- **Implementation:**
```sql
INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)
SELECT
  cs.id,
  cs.payment_method,
  cs.total_amount,
  cs.created_at
FROM public.counter_sales cs
ON CONFLICT (sale_id, method) DO NOTHING;
```
- Safe for tenants with existing data and tenants with empty databases.

---

## 10. Definer Function: `post_counter_sale`

- **File:** `supabase/migrations/20261113230400_post_counter_sale_payments.sql`
- In step 4 (after inserting `counter_sales`), insert into `counter_sale_payments`:
```sql
INSERT INTO public.counter_sale_payments (sale_id, method, amount, created_at)
VALUES (v_id, p_sale->>'payment_method', v_total, v_posting);
```
- Preserves the API contract: Express continues to pass `payment_method` in `p_sale`.
- Grants: strictly to `service_role`. `REVOKE EXECUTE ON FUNCTION public.post_counter_sale(jsonb, text, uuid) FROM public, anon, authenticated;`.

---

## 11. Invariant Check

Spec §7 requires an invariant check ensuring no migration grants `INSERT`, `UPDATE`, or `DELETE` on `counter_sale_payments` to `anon` or `authenticated`.

- **File:** `scripts/audit/check-invariants.mjs`
- **Check ID:** `no-client-writes-on-counter-sale-payments`
- **Rationale:** In Supabase, `authenticated` includes any signed-in customer/shopper. Granting write permissions on `counter_sale_payments` would expose settlement records to client-side manipulation via PostgREST.

---

## 12. Planned Files & Line Budget

Every proposed file is kept well below the 200-line repository ceiling:

| File Path | Purpose | Estimated Lines |
| :--- | :--- | :--- |
| `supabase/migrations/20261113230100_payment_methods.sql` | Lookup table, seed data, RLS | ~35 lines |
| `supabase/migrations/20261113230200_counter_sale_payments.sql` | Settlement table, RLS, triggers, sum check | ~95 lines |
| `supabase/migrations/20261113230300_counter_sale_payments_backfill.sql` | Idempotent backfill from `counter_sales` | ~25 lines |
| `supabase/migrations/20261113230400_post_counter_sale_payments.sql` | Updated `post_counter_sale` definer function | ~150 lines |
| `scripts/audit/check-invariants.mjs` | Added invariant check for table write grants | ~25 lines added |
| `artifacts/api-server/tests/counter-sale-payments.integration.test.ts` | Test suite covering sum check, immutability, replay | ~130 lines |

**Flag on files over 200 lines:** None. All new and modified files remain strictly under 200 lines.
