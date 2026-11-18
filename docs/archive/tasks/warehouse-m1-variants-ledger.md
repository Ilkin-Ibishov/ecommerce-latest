# M1 — Variant Layer + Stock Movement Ledger + Roles

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants that outlive this phase live in `.agents/rules/inventory.md` — read them; they
are not repeated in full here.

## 1. Why this exists

Two defects sit at the bottom of the current schema, and every feature planned after this one
inherits them.

**The product is the SKU.** `products` carries `sku`, `price` and `stock` directly. The first
customer sells the same item in several sizes and colours, displays them separately **and prices
them differently** — so a variant layer is not optional and cannot be papered over in the admin UI.
The storefront, cart and order lines all point at products today.

**Stock is a mutable integer with no history.** `products.stock` answers *"how many right now?"* and
nothing else — not why it changed, not who changed it, not what the units cost. It is also silently
overwritable: `PUT /admin/products/:id` accepts `stock` in the body, so editing a title can write
back a stale count and destroy a correct one. A second, worse case already exists in
`artifacts/api-server/src/routes/admin/orders.ts` (~line 92): `update({ stock: prod.stock + qty })`
is a read-modify-write, so two concurrent restocks lose one of them.

The two are fixed together on purpose. The ledger has to reference *something*; if that something is
the product, the whole ledger is rewritten when variants land — an append-only table migrated twice.

**Roles are in M1** because the first customer has three staff, intends to delegate data entry, and
named inability to detect theft as a top pain. Attribution added later cannot explain what already
happened.

**M1 ships no new user-facing capability.** It is foundation work. Resist adding features to make it
feel productive.

## 2. Customer context that should inform judgement calls

- ~500 products, 50-100 sales/day, 3 staff, one shop with an adjacent store room. **This is not a
  scale problem.** Do not add caching, denormalisation or background jobs for volume that does not
  exist. Prefer the simple query.
- Barcode scanner already in use; 90%+ of goods carry barcodes. A scan should be one round trip.
- The customer previously bought inventory software and abandoned it because it was inconvenient.
  The competitor is a notebook, and the notebook already won once. If an endpoint forces the UI into
  a multi-step dance for a daily task, the endpoint is wrong.
- No stock is tracked today; the last physical count was a year ago. There is no real data to
  migrate (see §5).

## 3. Decisions already taken — do not re-litigate; flag if you believe one is wrong

**Numeric quantity, integer-only UI.** The first customer sells nothing by weight or length. The
column is numeric anyway because a later customer selling fabric, cable or food will need it and the
cost today is zero. The UI does not expose fractional entry.

**Single total quantity; location is a hook, not a feature.** Stock is one number per variant. The
adjacent store room is not modelled. Movements carry a nullable location reference so locations can
be added later without rewriting existing rows.

**No bill of materials in v1.** Gift boxes were expected to need one. The customer's actual patterns
are pre-assembled on the shelf, assembled on order, and customer-configured — and box contents are
not standardised, so templates would carry little value. Boxes will be sold in M3 as multi-line
sales with a discount rule, deducting each component at the point of sale. No parent entity, no
assembly operation, no BOM table now. **M1's obligation:** reserve the reason codes for assembly
consume/produce so the enum needs no migration later, but build nothing behind them.

**Reservations arrive in M2, not M1.** The shop takes deposits: goods promised to a customer, still
physically present, collected days later. `on hand` unchanged, `available` reduced. **M1's
obligation:** design so that introducing a reservation table in M2 requires no change to rows
already written and no change to the movement schema. Reservations are never movements.

**Role defaults.** Owner sees cost and margin; staff do not. Each of the three staff gets a login;
every movement records who made it. Staff may sell and adjust stock with a reason; staff may not
change prices or delete history. Propose the smallest role model that satisfies this — do not invent
a permission framework.

## 4. What a movement record must answer

Design the columns and argue for them.

- Which variant; optionally which location (nullable hook)
- How much changed, in which direction
- **Why** — a closed, typed set: goods receipt, online sale, counter sale, customer return, return to
  supplier, damage/write-off, stocktake correction, manual adjustment, plus the assembly
  consume/produce pair reserved for later. Free text is not a reason.
- What it refers to — order, future purchase order, future stocktake. Optional but typed.
- Unit cost at the time of movement. Incoming movements carry it. Decide and justify whether
  outgoing movements record consumed cost now or in M2 with the weighted-average work.
- Acting user and timestamp
- Optional human note

## 5. Call sites to migrate

A starting point, not a complete list — roughly 311 `product_id` references across 46 files, so
treat discovery as part of the task. `pnpm run audit:invariants --update-baseline` currently records
6 known direct-stock-write violations; **M1 must bring `pnpm run audit:invariants:strict` to green.**

**Stock mutation paths**
- `artifacts/api-server/src/lib/rpc.ts` — `decrementStockSafe` / `incrementStock` wrappers
- `supabase/schema.sql` ~line 240 — the `decrement_stock_safe` / `increment_stock` bodies
- `artifacts/api-server/src/routes/admin/products.ts` — `PATCH /admin/products/:id/stock` (direct
  update, audit row but no reason); `POST`/`PUT` accepting `stock` in the body; duplication path
- `artifacts/api-server/src/routes/admin/orders.ts` ~line 92 — the read-modify-write described above
- `artifacts/api-server/src/routes/orders.ts` and the cancellation path
- `artifacts/store/src/components/admin/StockCell.tsx`

**Sellable-reference paths (product → variant)**
- `cart_items.product_id`, `order_items.product_id`, `wishlists.product_id`
- cart, orders, search and storefront routes under `artifacts/api-server/src/routes/`
- the generated API layer: `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`
- `artifacts/store/src/pages/admin/ProductsPage.tsx`, `ProductFormPage.tsx`, `InventoryPage.tsx`,
  and the storefront product pages

**Leave alone:** reviews/comments and categories stay attached to the product.

**Decide and justify:** should product create/update stop accepting a quantity entirely, or accept
it on *create only* as an opening balance? State the admin-UX trade-off.

**Opening balances.** For the first customer, existing `products.stock` values are meaningless —
nothing has been tracked and real quantities come from a physical count in M2. Propose a migration
correct for **both** cases: an existing tenant with meaningful quantities (carry them in as a dated
opening-balance movement) and a new tenant with none (open at zero). Say what actor and cost basis
an opening movement uses when none is known.

## 6. Open questions — answer in the design note, before any migration

1. **Enforcement point.** Database-side (trigger or stored procedure guaranteeing the pairing) or
   application-side (service layer, one transaction)? The DB side is harder to bypass and survives
   any future client; the app side is easier to test. This codebase already leans on Postgres RPCs
   for atomicity. Recommend one with reasoning, then implement it.
2. **Migration strategy** for ~311 references across ~46 files: big-bang, or a compatibility
   view/shim letting routes move incrementally? State the rollback plan and how `main` stays
   deployable throughout.
3. **Order history durability.** `order_items` already snapshots title and price. Should it also
   snapshot the variant's option values so a historical order survives an option rename?
4. **Barcode lookup.** Propose the endpoint shape that turns one scan into one round trip returning
   everything the screen needs, and say where the barcode uniqueness constraint belongs.
5. **Indexes and query patterns.** Name the access patterns (per-variant timeline, per-day totals,
   per-reason aggregation) and the indexes they need — without pre-optimising for absent volume.

## 7. Deliverables, in order

1. **A design note first (~1-2 pages)** at `docs/design-notes/m1-variants-ledger.md`, answering §6
   and proposing the schema for variants, options, movements and roles. Commit it and **stop** —
   do not write migrations before it is reviewed.
2. Migration(s) under `supabase/migrations/`, following the existing naming and RLS conventions.
3. Regenerated API layer (OpenAPI spec → Orval codegen → Zod schemas).
4. Updated/wrapped RPCs preserving current atomic semantics.
5. API route changes closing every unlogged write path.
6. Admin UI: variant management on the product form (option types and values as data), a movement
   history view per variant showing who and why, a reason selector on the inline stock editor, and
   cost/margin hidden from non-owner roles.
7. Tests per `.agents/rules/testing.md`, including a property/concurrency test asserting the ledger
   sum equals on-hand quantity after interleaved operations. `tests/helpers/stock-model.ts` already
   simulates decrement behaviour — extend it rather than writing a parallel model.

## 8. Definition of done

- `pnpm run typecheck` green
- `pnpm test` green, with the new concurrency and RLS tests present
- `pnpm run audit:invariants:strict` green — the baseline is empty
- `main` is still deployable at every commit on the branch
- Every item in §7 exists, or the design note says why it should not

## 9. Out of scope

Suppliers, purchase orders, cost averaging, stocktakes, reservations and deposits, bills of
materials, assembly, bundle pricing, POS, barcode-driven receiving flows, locations, lot tracking,
customer debt, delivery, reorder suggestions.

Each is its own milestone, and each should reduce to "a new reason code plus a UI" if M1 is designed
well. If something here genuinely cannot be done cleanly without one of them, say so rather than
quietly expanding scope.
