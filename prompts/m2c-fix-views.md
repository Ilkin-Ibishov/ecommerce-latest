# M2c — a view leaks every deposit customer's name and phone to any logged-in shopper

Found by applying Supabase's own security checklist to the M2c schema. One blocker, one medium, one
invariant. Prescriptive: implement exactly as written, change nothing else.

Work on `m2c/reservations`. One commit per item.

---

## V1 — `reservations_view` bypasses RLS and is granted to `authenticated`  [blocker]

`supabase/schema.sql` and `supabase/migrations/20261104183000_m2c_effective_status.sql`:

```sql
CREATE OR REPLACE VIEW public.reservations_view AS
SELECT r.id, …, r.customer_name, r.customer_phone, …, r.agreed_price, r.paid_amount, … FROM public.reservations r;

ALTER VIEW public.reservations_view OWNER TO postgres;
REVOKE ALL ON public.reservations_view FROM anon;
GRANT SELECT ON public.reservations_view TO authenticated, service_role;
```

Two facts combine into a leak:

1. A Postgres view is **not** `security_invoker` by default, so it runs with its owner's privileges.
   The owner is `postgres`, which bypasses RLS. The `reservations` table's own policies — correctly
   limited to `role IN ('admin','staff')` — therefore do **not** apply when reading through the view.
2. `authenticated` is not staff. This storefront has customer accounts: shoppers sign in with OTP,
   keep addresses, and place orders. Every one of them holds the `authenticated` role.

So any signed-in customer can call PostgREST directly:

```
GET /rest/v1/reservations_view?select=*
```

and read every deposit in the shop — `customer_name`, `customer_phone`, `agreed_price`,
`paid_amount`, `notes`. Other people's names and phone numbers, exposed to anyone with an account.

The table is protected. The view is the hole.

### Fix

New migration `supabase/migrations/20261105200000_m2c_view_security.sql`:

```sql
ALTER VIEW public.reservations_view SET (security_invoker = true);
```

With `security_invoker = true` the view evaluates `reservations`' RLS as the **calling** role, so
staff and admin see rows and a customer sees none. Keep the grant to `authenticated` — RLS now does
the filtering, which is the whole point. `service_role` keeps bypassing RLS, so the admin API is
unaffected.

Mirror the change in `supabase/schema.sql` next to the view definition, with a one-line comment
saying why the flag is there, so the next person does not remove it.

**Do not** solve this by dropping columns from the view, and do not revoke `authenticated` — the
staff deposit screen reads it.

### Test

In the store test suite, assert with a **customer** (non-staff, non-admin) token that
`reservations_view` returns zero rows while the same query with a staff token returns the seeded
reservation. If the existing test harness cannot mint a plain customer token, say so in your notes
and assert the migration contains the `security_invoker` setting instead — but try the real test
first.

## V2 — `product_variant_availability` exposes reserved quantities to customers  [must]

Same root cause, smaller payload. That view is granted to `authenticated` and exposes
`reserved_quantity` and `deficit_quantity`, which are the shop's commercial figures, not a shopper's
business.

`security_invoker` is **not** the fix here: the view's purpose is to aggregate `reservations` for
callers who cannot read that table, so invoker rights would make it return zeros.

### Fix

In the same new migration:

```sql
REVOKE ALL ON public.product_variant_availability FROM authenticated;
GRANT SELECT ON public.product_variant_availability TO service_role;
```

The admin screens already reach it through the Express API with the service-role client, so nothing
staff-facing breaks. `product_variant_public_availability` keeps its `anon` grant and its single
`available_quantity` column; verify it still resolves after the revoke — it selects from the full
view and runs with owner rights, so it should.

Mirror in `schema.sql`.

### Test

An `authenticated` (customer) token reading `product_variant_availability` is refused; an anonymous
read of `product_variant_public_availability` still returns `available_quantity`.

## V3 — an invariant so this class cannot return  [must]

Add to `scripts/audit/check-invariants.mjs`, named `no-sensitive-columns-in-exposed-views`:

A `CREATE … VIEW` in `supabase/schema.sql` or any migration that is granted to `anon` or
`authenticated` must either set `security_invoker = true` or expose no column matching
`/customer_name|customer_phone|agreed_price|paid_amount|reserved_quantity|deficit_quantity|cost|margin/i`.

Static SQL parsing has limits. If you cannot implement this reliably, implement the narrower check —
every `CREATE … VIEW` granted to `anon` or `authenticated` must appear within 20 lines of either a
`security_invoker` setting or an explicit `REVOKE … FROM authenticated` — and say in your notes which
version you built and what it cannot catch. Do not write a check that passes vacuously.

---

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- The new invariant present and passing
- The tests in V1 and V2 present, or a note saying precisely why one could not be written
- `docs/audits/m2c-fix-views-notes.md` written, with the real output of the three commands

Do not run migrations against any remote Supabase project.
