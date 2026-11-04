---
trigger: model_decision
description: Load when working on stock, quantities, variants, the movement ledger, reservations, bundles or anything that changes how much of something exists
---

# Inventory domain rules

Full reasoning: `docs/tasks/warehouse-architecture.md`. These are the rules that survive it.

## The unit of inventory
- Stock exists **only** on variants. No quantity column on `products`.
- Price and SKU live on the variant.
- Every product has at least one variant. A simple product is a product with one variant —
  so there is no `has_variants` flag and no branching on whether variants exist.
- Options (colour, size, scent) are rows in option tables, never columns. A `color` column is a bug.

## The ledger
- Every change to on-hand quantity writes exactly one immutable movement row carrying a typed
  reason and the acting user. There is no other way to change a quantity.
- Movements are append-only. Corrections are compensating rows.
- Quantity and the sum of movements must never be able to disagree.
- Quantity cannot go negative; concurrent decrements must stay atomic.

## Operational repair
- `rebuild_on_hand` is an emergency owner-only repair function to resynchronize cached `on_hand`
  with the canonical sum of `stock_movements`.
- It is the sole authorized bypass for `trg_guard_variant_on_hand_update`, using the transaction-scoped
  configuration setting `inventory.allow_on_hand_repair`.
- Never set or reference `inventory.allow_on_hand_repair` outside the repair function's own migration.

## Reservations are not movements
A reservation (a deposit, a held order) does not change what is physically present. It reduces
*available*, not *on hand*. Writing a reservation into the movement ledger corrupts the meaning of
the ledger sum. Reservations belong in their own table with an expiry. This is the single most
expensive mistake available in this domain.

## Blind counting
Blind counting prevents the honest counter from being anchored by a screen value and forces a dishonest counter to query PostgREST directly (leaving traces), but does not prevent direct PostgREST reads of `product_variants.on_hand` because storefront/admin availability paths require that column to be readable.

## Quantities
- Quantity columns are numeric with scale, not integers — a later customer will sell by weight or
  length. The admin UI does not expose fractional entry until a customer needs it.
- Every variant carries a unit of measure.

## Composition
- A bundle whose contents are assembled at the moment of sale has **no stock of its own**; it is a
  multi-line sale with a discount rule. Never store a quantity for it.
- An assembled kit that sits on a shelf holds its own stock and must have consumed its components.
- One physical unit is counted in exactly one place: loose on the shelf, or inside an assembled kit.
  Never both.

## Naming
No table, column, enum value or identifier named after a customer's industry. This module ships to
many shops; a schema that names the first one cannot be sold to the second.
