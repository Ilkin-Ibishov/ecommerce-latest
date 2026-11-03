# M1 — two fixes, then the branch is done

The schema additions are otherwise correct and verified: `audit:invariants:strict` is green with an
empty baseline, typecheck passes, 546 unit tests pass, the API layer was genuinely regenerated
through codegen, and `pack_quantity` is actually multiplied in the adjust flow rather than merely
stored. Two defects remain. One commit each.

---

## G1 — the `posting_date` backfill cannot run  [must]

`supabase/migrations/20261103210000_m1_schema_additions.sql`:

```sql
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS posting_date timestamptz NOT NULL DEFAULT now();

UPDATE public.stock_movements
SET posting_date = created_at
WHERE posting_date IS NULL;
```

`ADD COLUMN ... NOT NULL DEFAULT now()` fills every existing row with the migration's own timestamp.
Nothing is ever NULL afterwards, so the `UPDATE ... WHERE posting_date IS NULL` matches zero rows. It
reads like a backfill and does nothing.

The consequence is specific and bad: a tenant that already has movements gets every historical row
stamped with the moment the migration ran, instead of the date the stock actually moved. The first
weighted-average replay in M2 then orders history by a date that is identical for every old row —
which is the exact failure `posting_date` was added to prevent.

Our first customer's ledger is empty, so this causes no harm today. It still fails the definition of
done: the migration must be correct for a populated database as well as an empty one.

Use the ordinary four-step pattern — add the column nullable, backfill it from `created_at`, then set
`NOT NULL`, then set the default. Add a test that a row existing before the migration ends up with
`posting_date = created_at`, not the migration time.

## G2 — a shared barcode resolves to an arbitrary row  [must]

`artifacts/api-server/src/routes/inventory.ts` around line 338, in the stock-adjust flow:

```ts
if (!variant_id) variant_id = bRows[0].variant_id;
const packQty = Number(bRows[0].pack_quantity ?? 1);
```

`bRows` can hold several rows, because one barcode mapping to several variants is scenario **S2** in
`docs/tasks/identification-scenario-matrix.md` — the reason the `variant_barcodes` table exists at
all. Taking `[0]` picks one of them silently.

Two distinct problems:

1. With no `variant_id` supplied and a shared barcode, the endpoint guesses which variant the
   operator meant. The scan *lookup* endpoint correctly returns a list for the operator to choose
   from; this one chooses for them, invisibly, and then moves stock.
2. Worse, when `variant_id` **is** supplied — the operator already picked from the list — `packQty`
   still comes from `bRows[0]`, which may be a different variant's row with a different pack size.
   Scanning a case of twelve can then post a movement of one, or the reverse.

Fix both: when a barcode resolves to more than one variant and no `variant_id` was given, reject with
an error naming the candidates rather than guessing. When `variant_id` is given, read `pack_quantity`
from **that variant's** barcode row. Add tests for both paths.

---

## Definition of done

`pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, plus the two
new tests above. Write `docs/audits/m1-fix-2-notes.md`.

After this the M1 branch is complete and goes to merge, so say plainly in your notes if you think
anything else on it is unfinished.
