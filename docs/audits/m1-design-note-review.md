# Architecture review — M1 design note

Reviewing `docs/design-notes/m1-variants-ledger.md` against
`docs/tasks/warehouse-m1-variants-ledger.md` and `.agents/rules/inventory.md`.

**Verdict: FIX — three blockers. The shape is right; do not redesign. Revise the note, then implement.**

---

## What is right, and should not change

**The PostgREST argument (Q1) is correct and better than the spec's framing.** `supabase-js` speaks
HTTP to PostgREST; there is no multi-statement transaction across two requests, so an application
-side "insert movement then update quantity" genuinely is split-brain-prone. An `AFTER INSERT`
trigger is the right enforcement point here, for the reason given. The spec asked for a
recommendation with reasoning and got a better one than it assumed.

**Deferring outgoing cost to M2 (disagreement 2) is correct.** Recording consumed cost before cost
layers exist records replacement cost and silently distorts margin. Good call, well argued.

**Also sound:** the three-phase additive migration keeping `main` deployable; snapshotting both
variant title and SKU on order lines; the partial unique index on barcode; the restricted index set;
`quantity_delta <> 0`; `ON DELETE RESTRICT` on `variant_id`; reserved assembly reason codes.

---

## Blockers

### B1. `cost_price` is world-readable

```sql
cost_price numeric(10,2) ...                       -- on product_variants
CREATE POLICY "Variants: public read" ON public.product_variants FOR SELECT USING (true);
```

§4.5 says staff cannot see cost or margin, "censored at API route level". **The API route layer is
not the boundary in this application.** The admin screens call PostgREST directly from the browser
(`createClient()` in `artifacts/store/src/pages/admin/InventoryPage.tsx` and others). With
`USING (true)`, `cost_price` is readable by any anonymous caller who queries `product_variants` —
not merely by staff. This publishes the shop's margins to the internet.

RLS is the boundary. A column-level restriction expressed only in Express is decoration.

Fix it structurally. Options, in order of preference:
1. Keep cost out of `product_variants` entirely — put `cost_price` in a separate `variant_costs`
   table whose RLS grants select to `admin` only. Public reads of the catalog never touch it.
2. Keep the column but drop the blanket public select, replacing it with a view for public catalog
   reads that does not project cost, plus an owner-only policy on the base table.

Pick one and say why. Option 1 is cleaner and also gives M2's weighted-average cost a natural home.

### B2. The `Insufficient stock` domain error disappears

Invariant 7 of the work order requires the existing `Insufficient stock` error path to survive. In
the proposed design, an oversell surfaces as a `CHECK (on_hand >= 0)` violation — Postgres SQLSTATE
23514, a generic constraint error. The caller can no longer distinguish "not enough stock" from any
other check failure, the API returns a 500 instead of a domain error, and the existing expectations
in `orders.test.ts` and `suspended-order-rejection.property.test.ts` no longer hold.

The trigger must detect the condition and raise a recognisable error itself — compute the resulting
quantity, and when it would go negative, `RAISE EXCEPTION` with the existing message shape and a
stable, catchable SQLSTATE that the RPC wrapper maps to the current API error. Keep the `CHECK` as a
backstop; it should be unreachable in practice.

### B3. The single-write-path guard is described but absent

§2 Q1 item 4 states that direct updates to `product_variants.on_hand` are blocked by a trigger using
`pg_trigger_depth() <= 1`. No such trigger appears in the DDL in §3.

This is the mechanism that makes "the ledger is the only way to change a quantity" a property of the
database rather than a convention. Without it the invariant rests on `check-invariants.mjs` and
reviewer attention, and the first writer that is not the API — a migration, a script, a future POS,
a person in the SQL console — bypasses it silently.

Write it, or state plainly that it was dropped and why. Do not leave the note claiming a guard the
schema does not have.

---

## Major

### M1. §2 Q1 claims `FOR UPDATE` locking that the DDL does not do

The mechanism section says the trigger locks the variant row with `FOR UPDATE`. The trigger body is
a bare `UPDATE ... SET on_hand = on_hand + NEW.quantity_delta`.

The **code is correct** — that statement takes a row lock and re-reads under it, so concurrent
increments are safe. The **claim is wrong**, and a wrong claim about a locking strategy is dangerous
in a way a missing one is not: the next reader sees "FOR UPDATE" in the design, does not find it in
the schema, and "fixes" it by adding a `SELECT ... INTO` before the update — which introduces
exactly the read-modify-write race this phase exists to remove.

Correct the note to describe what the statement actually does and why it is sufficient.

---

## Minor

- **Staff can change prices.** `"Variants: admin/staff write" ... FOR ALL` grants staff UPDATE on
  every column including `price`, while §4.5 says they cannot. Split the policy: staff get
  INSERT/UPDATE where it is needed, admin gets the rest — or accept staff price edits and change
  §4.5. Either is fine; the note and the schema disagreeing is not.
- **`is_default` can drift.** Nothing stops two default variants on one product. Add
  `CREATE UNIQUE INDEX ... ON product_variants(product_id) WHERE is_default`.
- **`reference_id text`** cannot be foreign-key enforced. Acceptable for a polymorphic reference —
  say so explicitly in the note so it reads as a decision rather than an oversight.

---

## Not findings — checked and sound

- Global `UNIQUE` on `sku` and the barcode index are correct here. This product is
  database-per-store (no `store_id`/`tenant_id` in `supabase/schema.sql`; stores are tracked in the
  control plane), so these uniqueness scopes are already per-tenant.
- Opening-balance handling for populated and empty tenants is correct for both cases.
- Reservations are absent, as M1 requires. Nothing in the ledger would need to change to add them.

---

## What to do

Revise the design note to resolve B1, B2, B3 and M1, and the two schema minors. Commit the revised
note. **Do not start the migration until that revision is reviewed** — B1 and B3 change the schema,
and B2 changes the trigger contract, so implementing first means writing them twice.
