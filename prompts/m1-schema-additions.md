# M1 — schema additions that cannot be backfilled

Run this **after** `prompts/m1-fix.md` is complete and committed.

These come from comparing our design against the canonical open-source implementations (Odoo
`stock`, ERPNext Stock Ledger Entry, InvenTree, Medusa, Saleor, Grocy) and the published import
templates of commercial POS products in our segment.

Every item here shares one property: **the ledger is currently empty, so adding these now costs a
column. Adding them after real movements exist means rows that can never have a correct value.**
That is the entire reason this is a separate, urgent task rather than part of M2.

Nothing here changes behaviour we have already built. These are additive.

---

## A1 — `posting_date` on `stock_movements`  [the important one]

Add a `posting_date` (date or timestamptz) distinct from `created_at`, defaulting to now, settable
by the caller.

**Why.** Quantity is order-independent: `SUM(quantity_delta)` commutes, so our AFTER INSERT trigger
is safe no matter what order rows arrive in. **Weighted average cost does not commute.** A receipt
entered on Thursday but dated Monday changes the average that every sale between Monday and Thursday
should have consumed. Without a business date distinct from the insert timestamp, there is no
correct order to replay the cost in, and the error is unfixable for every row already written.

This is not speculative. ERPNext separates `posting_date` / `posting_time` / `posting_datetime` from
`creation` and ships `Repost Item Valuation` with `repost_future_sle()` to replay cost after a
back-dated entry. Odoo carries `_run_fifo_vacuum()` for the same reason. Both treat running cost as a
**replayable projection ordered by business date**, not as a running total maintained at insert time.

**Also, for M2 — do not extend the AFTER INSERT trigger to compute cost.** The trigger sees insert
order, not business order. Cost belongs in a replay keyed on `posting_date`, which at a few hundred
variants is milliseconds. Note that decision next to the trigger so M2 does not undo it.

## A2 — grouping and reversal keys on `stock_movements`

Add `transaction_id` (uuid, nullable) and `correlation_id` (uuid, nullable).

- `transaction_id` groups the movements produced by one operation: a multi-line counter sale, an
  assembly's consume/produce pair, a stocktake batch. Without it, "show me that sale" is
  unanswerable and a partial reversal cannot find its siblings.
- `correlation_id` links a compensating movement to the one it reverses. The ledger is append-only,
  so corrections are new rows — but with no link, a reversal is indistinguishable from an unrelated
  adjustment.

Grocy carries both (`transaction_id`, `correlation_id` on `stock_log`). Neither can be backfilled:
rows written before the column exists have no group and no original.

## A3 — pack quantity on the barcode row

`prompts/m1-fix.md` F3 introduces `variant_barcodes`. Add two columns to it while it is being
created: a quantity (how many stock units one scan of this code represents, default 1) and the unit
that quantity is expressed in.

**Why.** The barcode on an outer case is not the barcode on the piece. Scanning the case should add
twelve, not one. Every system that takes scanning seriously attaches a quantity to the code or the
packaging: ERPNext's `Item Barcode` child table carries `uom`; Grocy's `product_barcodes` carries
`amount` and `qu_id`; Odoo adds `product.packaging(product_id, qty, barcode)` in the same uniqueness
namespace.

Without it, receiving a case becomes mental arithmetic at the counter. Our first customer abandoned
their previous system for being inconvenient — this is exactly that failure mode, and it costs two
columns to avoid.

## A4 — two fields that appear in every commercial template, including free tiers

On `product_variants`:

- `track_stock` (boolean, default true) — not everything a shop sells is counted. Services, made-to-
  order items, and consumables are sold without inventory. Loyverse, Shopify (`Inventory tracker`),
  Medusa (`manage_inventory`) and Saleor (`track_inventory`) all carry it.
- `low_stock_threshold` (numeric, nullable) — alerts are M6, but the **data should start
  accumulating now**. Loyverse, Square (`Stock alert count`) and InvenTree (`minimum_stock`) all
  carry it. A threshold set today is worth more than an alerting engine built later.

---

## Not in this task — recorded so they are not lost

These are real but not backfill-sensitive. Do **not** build them now; they belong to M2 and will be
specified there. Add them to `docs/tasks/warehouse-m2-*.md` as a "carried forward" section if that
file does not exist yet, or to the roadmap section of the design note.

- **`rebuild_on_hand(variant)` and `verify_stock_integrity()`.** A cached quantity makes divergence
  unlikely, not impossible. Both systems that cache ship a repair tool — ERPNext's
  `stock_balance.repost()` rebuilds every `Bin` from the ledger; Odoo runs `_quant_tasks()`. Our
  system design already calls for a drift *alert*; this is its repair counterpart.
- **Stocktake optimistic concurrency.** A count submitted thirty minutes after it was taken silently
  erases the sales in between. Shopify sends `On hand (current)` alongside `On hand (new)` and
  documents the former as a safety snapshot; Square does the same. M2's stocktake should accept
  `{variant_id, counted_qty, observed_on_hand}` and reject the line on mismatch. Note that this is
  the same defect class as F1 in the fix task.
- **`allow_negative_stock` as a tenant setting.** Keep non-negative as the default. But a shop that
  receives goods on Monday with paperwork due Wednesday will sell them on Tuesday, and a counter that
  refuses sends the operator back to the notebook. ERPNext, Medusa, Shopify and Odoo all provide an
  override. Make it a setting, record each override as a movement note.
- **Unit-of-measure immutability.** Changing a variant's stock unit after movements exist silently
  reinterprets history. Grocy aborts it with a trigger once the log has a row. Cheap, but nothing to
  protect until movements exist.

## Definition of done

- Migration applies cleanly to both a populated and an empty database
- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green
- A test that a scan of a code with pack quantity 12 produces a movement of 12, not 1
- `docs/audits/m1-schema-additions-notes.md` with what changed, anything you disagree with, and real
  command output
