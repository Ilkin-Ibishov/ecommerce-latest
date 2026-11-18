# Chore — `counter_sale_payments`

Spec, written 2026-11-13 by the architect. Source of the decision:
`warehouse-m3-section-16-decisions.md` §16.4. This chore is the schema half of it; there is no UI change.

## 1. Goal

Money taken at the till is stored as settlement rows, one per tender, instead of one text column on
the sale. The till still writes exactly one row. Split tender later becomes a screen change, not a
migration plus a report rewrite.

## 2. What exists today

- `counter_sales.payment_method text NOT NULL CHECK (... IN ('cash','card','other'))`
  (`20261111120300_m3_counter_sales.sql`).
- `post_counter_sale(p_sale jsonb, ...)` takes `payment_method` in the payload and inserts the header
  and lines in one transaction (`20261111120400_...`). `post_pending_counter_sale` and
  `void_counter_sale` do not read the column.
- Readers of the column: `routes/admin/counter-sales.ts` (list select), `CounterPage.tsx` (sends it),
  `CounterReceiptPage.tsx`, `CounterSalesPage.tsx`, `supabase-types/database.types.ts`, and three
  integration tests under `artifacts/api-server/tests/`.

## 3. Schema

One migration, one concern per file where the repo already splits them (lookup, table, function change
= three files is fine; follow the timestamp naming after `20261111120800`).

1. **`payment_methods`** — lookup, not an enum (§16.4: the fourth method arrives from the customer).
   `code text PRIMARY KEY`, `label text NOT NULL`, `active boolean NOT NULL DEFAULT true`.
   Seed `cash`, `card`, `bank_transfer`, `other`. `other` must exist: it is a legal value today and
   the backfill needs it. RLS enabled; admin/staff read, no client writes.
2. **`counter_sale_payments`** — `sale_id uuid NOT NULL REFERENCES counter_sales(id) ON DELETE
   RESTRICT`, `method text NOT NULL REFERENCES payment_methods(code)`,
   `amount numeric(12,2) NOT NULL CHECK (amount >= 0)`, `created_at timestamptz NOT NULL DEFAULT now()`,
   `PRIMARY KEY (sale_id, method)`. A zero amount is legal because a bundle discount can bring a sale
   to 0. RLS enabled, admin SELECT only, same as `counter_sales`. Writes only through the SECURITY
   DEFINER functions (service_role).
3. **Sum constraint.** A `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `counter_sale_payments`
   (insert, update, delete) raising if `sum(amount) <> counter_sales.total_amount` for that sale. Deferred,
   so a multi-row split inserts legs in any order and is checked once at commit. A sale with no payment
   row is also a failure: every counter sale, including `needs_owner`, is a paid sale (M3 spec §4).
4. **Immutable after insert.** No UPDATE or DELETE path: a trigger that raises, as for
   `stock_movements`, or at minimum no grant. Say in the design note which, and why.
5. **Backfill** every existing `counter_sales` row into one `counter_sale_payments` row
   (`method = payment_method`, `amount = total_amount`). Must be re-runnable and must succeed on rows of
   every status including `voided`.
6. **`post_counter_sale`** inserts the header, then the one payment row, in the same transaction and
   before the commit. The payload keeps `payment_method` and the function derives the single row from
   it; the API contract does not change.

## 4. The old column

Two sources of truth for money is exactly the ambiguity §16.4 warns about. The architect's call:

- **This chore keeps `counter_sales.payment_method`** so no read path, page or generated type changes,
  and writes both from the same value inside `post_counter_sale`. Mark it deprecated in a SQL comment.
- The API list/detail may keep selecting it unchanged.
- A later chore moves the readers to the payments table and drops the column. Not now.

If the builder finds a way to drop the column with the API mapping the value back so no page changes,
it may propose it in the design note. Do not do it silently.

## 5. The two rules from §16.4

- **Lock the sale before the first payment is captured; never modify lines or prices afterwards.** The
  payment row is written inside `post_counter_sale`'s one transaction, after the variant locks and the
  sum check, so it holds by construction. State in the design note why no separate lock is needed, and
  which function would need one if a payment could ever be added to an existing sale.
- **A refund settles against the original tenders, per leg.** `void_counter_sale` stays status-based and
  writes no negative payment rows. For a voided sale the refundable legs are exactly its payment rows.
  Document this in the migration comment on the table. Do not add refund rows now.

## 5a. Deposit pick-ups — decided: out of scope for this chore

§16.4 says a pick-up should write a payment row. Checked against the code, it cannot be done here:

- `fulfil_reservation(p_reservation_id, p_actor_id, p_final_payment numeric)` takes an amount and **no
  method**, and the pick-up panel (`PickupPanel.tsx`) always sends `final_payment: balance` with no
  method picker.
- A pick-up is not a counter sale, so there is no `sale_id` to hang a row on. Deposits taken earlier
  (`reservations.paid_amount`) also carry no method.

Recording it needs a method field on the pick-up (a UI change) and a decision on the parent key. That is
a separate chore. Say in the design note what the day-end count will therefore miss until then. Do not
invent a method for pick-ups.

## 6. Tests

- Unit/integration against the test project: one-leg sale writes exactly one row equal to the total; a
  hand-inserted two-leg split that sums correctly commits; one that does not sum is refused at commit;
  an UPDATE or DELETE on a payment row is refused; backfill produces one row per existing sale; a
  voided sale keeps its payment rows; replaying `post_counter_sale` with the same id and hash writes no
  second row.
- The existing counter integration tests keep passing unchanged. If one breaks, fix the cause, never
  skip it.
- `pnpm run typecheck`, `pnpm test:unit`, `pnpm run audit:invariants` pass. State which tiers actually
  ran; the integration tier runs in CI.

## 7. Invariant

Add one check to `scripts/audit/check-invariants.mjs`: no migration after this one grants INSERT,
UPDATE or DELETE on `counter_sale_payments` to `anon` or `authenticated`. Note for the grant rule:
`authenticated` here includes every signed-in shopper.

## 8. Intersections the design note must answer

For each: ordinary-flow behaviour, and which earlier decision it meets.

- `post_pending_counter_sale` (owner resolves a `needs_owner` sale): the payment row already exists from
  the original post. Confirm it writes none.
- `void_counter_sale` on a `needs_owner` sale: payments exist but no movements were made.
- Idempotent replay and the `ON CONFLICT` race path in `post_counter_sale`: the payment insert must not
  run twice.
- The backfill and the margin report: revenue still comes from the sale total, not from payments.
- Rows from before the M3 migration that fail the deferred sum check.

## 9. Not in scope

UI, receipt, day-end report, refunds, split-tender screen, dropping the old column, deposit pick-ups
(§5a), any new payment method in the UI.
