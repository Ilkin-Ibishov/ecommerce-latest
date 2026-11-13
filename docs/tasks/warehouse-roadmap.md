# Warehouse roadmap — what remains after M3a

Written 2026-11-13, after the §16 answers closed M3b and the assembly question.
Supersedes the milestone table in the architecture ADR §7, which was written before any
phase shipped and no longer matches what was built.

---

## Where the line actually is

| Phase | Delivered | Status |
|---|---|---|
| M1 | Variant layer; stock only on variants; append-only ledger with apply + immutability triggers | merged |
| M2a | Suppliers, goods receipts, weighted-average cost as a replayable projection, margin report | merged |
| M2b | Stocktake, opening count, blind counting, delta corrections, shrinkage | merged |
| M2c | Reservations, deposits, in-database availability, atomic multi-item decrement | merged |
| M3a | Counter sale, barcode + text search in one box, minimal bundle, plain receipt | merged |
| M3b | Offline queue | **dropped** — §16.5: the shop's connection does not drop |

The ADR's M3 (real assembly) and M5 (configurable bundles) are **not** next. §16.6 answered
that pre-assembled boxes sit on the shelf for a day or two, so §10's minimal bundle holds.

## The one sentence that orders what is left

> Everything shipped so far **records what happened**. Nothing yet **tells the owner what to
> do**. That is the gap worth closing next, and it is also the first thing a second customer
> would pay for.

A ledger, a cost projection and a till are infrastructure. The owner's actual questions are
"what am I about to run out of", "what should I order", and "what is my money sitting in that
nobody wants". None of those are answerable today, and all three are cheap now precisely
because M1–M3a built the data to answer them.

---

## M4 — The owner's operating loop

**Low stock, reorder suggestions, dead stock, and making `track_stock` mean what it says.**

Full spec: `docs/tasks/warehouse-m4-stock-signals.md`.

Why here: it is the first phase whose output is a decision rather than a record; its data
already exists (`low_stock_threshold` per variant and a global default both shipped in M1);
and it is the most demonstrable feature in the product. It needs no customer answer to start.

## M5 — Labels and the second shop

**Code 128 label printing from the variant list, plus whatever onboarding the second tenant
exposes.**

Why after M4: it is a smaller, better-understood piece of work, and the second shop is a
commercial conversation that has not happened yet. §16.10 fixed the constraints already —
Code 128 over a self-minted EAN-13, never a second barcode for a product that has a working
one, uniqueness in the database. `variant_barcodes` exists, so this is a print view and a
generator, not a data model.

Keep it one phase behind M4 unless the second shop signs first, in which case swap them.

## Not a phase

- **Split tender UI.** Once `counter_sale_payments` exists (see chore below), this is a
  screen change. It does not need a milestone.
- **The `counter_sale_payments` migration itself.** One table, one backfill of the existing
  single-method column, one route change. A chore between M3a and M4, not a phase. Doing it
  before M4 keeps it off a growing table.
- **The receipt's required field list.** One change to §11 when the accountant's written
  answer names the fields.

## Deferred, with the reason, so it is not re-litigated each quarter

| Deferred | Re-open when |
|---|---|
| Real assembly: kit stock, `assembly_consume` / `assembly_produce`, frozen component cost | A shop holds assembled boxes for weeks, visible as repeated stocktake variance on component variants |
| Configurable bundle builder (customer picks 5 of 30) | A customer asks for it; the BOM slot columns are designed but unpopulated |
| Multi-location and transfers | A second physical location exists. The nullable location reference on movements is the hook |
| Lot, batch, expiry, serial | A customer sells something with an expiry date |
| FIFO cost layers | An accountant requires it. WAC is the recorded decision |
| Cycle-count scheduling, ABC analysis | Stocktake volume makes a full count impractical |
| Gift certificates / store credit | §16.11's second question is answered yes — then its own phase, because a certificate is a liability, not a product |

## What is not on this roadmap, deliberately

Two open items block go-live and neither is engineering: the 500 products' names, prices and
photos (nobody assigned), and the design-partner agreement and monthly price. Completing M4
and M5 still leaves a finished, empty, unsold system. This file plans the engineering so that
it is not mistaken for progress on those.
