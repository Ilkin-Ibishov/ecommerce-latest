# Product identification — scenario matrix

How a shop tells one product from another. This is the dimension where customers differ most, so it
gets an explicit matrix rather than per-customer guesswork.

**The rule this matrix exists to enforce:** the *data model* admits every scenario below; the *user
interface* handles only the rows marked "now". A scenario the model cannot represent is expensive to
add later; a scenario the UI does not yet handle is cheap to add later. Keep the asymmetry.

## Known customer facts

| | Customer 1 (gift shop, committed) | Customer 2 (prospect, undecided) |
|---|---|---|
| Barcode scanner | Owned. Daily use **unconfirmed** — price is read from the label or from memory, which suggests it is not driving sales today | Unknown |
| Goods carrying a barcode | ~90% | **None** |
| Products without one | ~10%, plus every gift box assembled in-house — those can never carry a manufacturer code | All |
| Naming discipline | Unknown | Poor — products are told apart by name and photo |

## The matrix

| # | Scenario | Model | UI |
|---|---|---|---|
| S1 | Manufacturer barcode, unique per variant | supported | **now** — scan resolves to one variant |
| S2 | One manufacturer barcode shared by several variants (same mug, four colours) | supported | **now** — scan returns a list, operator picks |
| S3 | No barcode; shop prints an internal label | supported | **M2** — needs SKU generation and a label template |
| S4 | One variant carrying several barcodes (supplier changed packaging; old and new stock on the shelf together) | supported | **now** — any of its codes resolves to it |
| S5 | No code of any kind; found by name | supported | **now** — existing text search |
| S6 | No code, poor naming; found by photo | not yet | **deferred** — see below |
| S7 | A barcode reused by a different product over time | **not supported** | **not planned** — rare enough to handle as a data correction |

## What S1–S5 require of the model

A single structural decision covers four of them: **barcodes live in their own table, not as a
column on the variant.**

```
variant_barcodes
  variant_id   → product_variants
  barcode      text
  source       'manufacturer' | 'internal'
  is_primary   boolean
```

- S1: one row per variant
- S2: several rows sharing a `barcode` value — **so barcode must not be globally unique**
- S3: rows with `source = 'internal'`
- S4: several rows for one variant, one of them primary

A `barcode` column with a unique index cannot express S2 or S4 at all. Inserting the second colour
of the same mug fails on the unique index — and shared manufacturer codes are ordinary supplier
behaviour, not an edge case.

Consequence for the scan API: **it returns a list, not a single object.** One match proceeds
directly; several render a picker. The picker is deliberately dumb for now — no ranking, no learning
which variant this operator usually means. That design depends on how many matches occur in practice
and whether the operator already knows the variant, which are observations, not guesses.

## Why S6 (image search) is deferred

The honest version of this feature is embeddings, not training: an off-the-shelf image model
produces a vector per photo, stored with `pgvector`, and search is nearest-neighbour. No per-tenant
model, no GPU, no training pipeline — which matters, because a per-tenant trained model breaks the
cost envelope in `system-design.md` §4.4.

Three reasons it waits:

1. **It resolves to a product, not a variant.** Twelve identical mugs in twelve colours are
   near-identical vectors. The thing stock is adjusted on is the variant.
2. **It makes onboarding heavier.** Three to five photos per product across hundreds of products,
   taken and uploaded by the shop owner. Getting *one* photo per product is already the unsolved
   blocker for customer 1.
3. **S3 solves the same problem for less.** A thermal label printer plus generated internal codes
   gives exact identification, works offline, and shares its code path with S1. Image search is a
   convenience on top of identification, not a substitute for it.

It stays on the roadmap as a differentiator for shops with no SKU discipline — a real segment, and
one competitors ignore because they assume barcodes exist. It needs its own justification and a
paying customer, not a prospect's maybe.

## Open questions

These change which UI ships first, not whether a scenario is supported. The model already covers all
four answers.

1. Is customer 1's scanner in daily use, or dormant?
2. Do the different colours of one product carry the same barcode number or different ones?
3. What is the ~10% without barcodes — handmade goods, unbranded stock, or the assembled gift boxes?
4. Does customer 2 own a scanner, or would internal labels mean buying hardware?
