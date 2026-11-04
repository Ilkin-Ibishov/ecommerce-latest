# Project status — handoff

Last updated: 2026-11-04. Written as the entry point for a new session. Everything referenced here
lives in this repository; nothing important is only in a chat transcript.

## Where to start

1. `AGENTS.md` — house rules for every agent session
2. `docs/tasks/` — specs, architect-owned. Agents read, never edit
3. `docs/design-notes/` — the implementer's proposals, written before code
4. `docs/audits/` — every review and every agent's own notes, in order
5. `.agents/rules/` — domain invariants, loaded on trigger

## State

**M1 is complete on `m1/variants-ledger` and verified. It has not been merged.**

Verified locally on 2026-11-04:

| Check | Result |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `pnpm run test:unit` | 549 tests, 39 files, exit 0 |
| `pnpm run audit:invariants:strict` | 0 violations, baseline empty |

The empty baseline is the headline: the six direct stock-write violations that existed when the
branch started are gone, and no new ones were introduced.

### What M1 delivered

- **Variant layer.** Stock, price, SKU and barcode moved off `products` onto `product_variants`.
  Options are data (`product_option_types` / `product_option_values` / `variant_option_values`),
  never columns. Every product has at least one variant; there is no `has_variants` flag.
- **Append-only movement ledger.** `stock_movements` with typed reasons. An `AFTER INSERT` trigger
  applies each movement to the cached `on_hand` in the same transaction; a `BEFORE UPDATE OR DELETE`
  trigger makes the table immutable; a `pg_trigger_depth()` guard rejects any direct write to
  `on_hand`, so the ledger is structurally the only way a quantity changes.
- **Cost isolation.** `variant_costs` is admin-only under RLS. Cost is not a column on a
  publicly-readable table — the admin client talks to PostgREST directly, so RLS is the boundary,
  not Express.
- **Roles.** Owner sees cost and margin; staff do not. Staff cannot change prices (API check plus a
  database trigger) and cannot post `opening_balance` or `stocktake_correction`.
- **Barcodes as a table.** `variant_barcodes` with `source`, `is_primary`, `pack_quantity`,
  `pack_unit`. No uniqueness on `barcode`, because one code may map to several variants and one
  variant may carry several codes. Scanning a case of twelve posts twelve.
- **Fields that cannot be backfilled**, added while the ledger was still empty: `posting_date`
  (business date, distinct from `created_at`), `transaction_id`, `correlation_id`, `track_stock`,
  `low_stock_threshold`.

### Decisions closed, and where the reasoning lives

| Decision | Where |
|---|---|
| Ledger enforcement in the database, not the service layer | design note §2 Q1 — PostgREST has no cross-request transaction |
| Cost replayed by `posting_date`, never computed in the trigger | migration comment, §A1 — WAC does not commute |
| No bill of materials in M1 | work order §3 |
| Reservations are not movements | `.agents/rules/inventory.md` |
| Identification handled by a scenario matrix | `docs/tasks/identification-scenario-matrix.md` |
| Image search deferred; internal labels first | same matrix |

## Next

**M2** — goods receipt, suppliers, weighted-average cost, stocktake, and reservations (deposits).
Reservations moved forward from M5 because the first customer takes deposits daily.

Carried forward into M2, from the prior-art comparison and the M1 audits:

- `rebuild_on_hand(variant)` and `verify_stock_integrity()` — a cached quantity makes divergence
  unlikely, not impossible; both Odoo and ERPNext ship a repair tool
- stocktake optimistic concurrency: accept `observed_on_hand` with the count and reject on mismatch,
  or a count submitted thirty minutes late silently erases the sales in between
- `allow_negative_stock` as a tenant setting, default off, each override recorded
- unit-of-measure immutability once movements exist
- `set_product_stock_safe` takes one parameter meaning either a variant id or a product id — split it

**M3** — counter sale, barcode flow, and a minimal bill of materials. The earlier plan was to sell
boxes as a discounted multi-line sale; that was reversed. A discount rule cannot count boxes, give a
box its own barcode, or price it as a thing, and Loyverse's free-tier import template shows shops in
this segment do fill composites in. Build parent / component / quantity plus one produced flag.

## Open

**Business — blocking go-live, not engineering:**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
2. Design-partner agreement and the monthly price.
3. The accountant's written answer on fiscal receipt requirements, which gates the counter-sale work.

**Technical:**

4. `main` is merged only up to the chore batches; M1 is not merged and nothing is pushed. The
   integration tier runs only in CI, so M1's concurrency and RLS tests are unverified until a push.
5. Is the first customer's scanner in daily use or dormant? Do colour variants share one barcode?
   What is the ~10% without barcodes? The model covers every answer; the answers decide which UI
   ships first.
6. `SESSION_SECRET` must be set in every deployed environment before the next deploy — the API now
   refuses to start without it, which is correct but will surprise a deploy that has not set it.

## How work runs here

Phases go: spec → design note → architecture review → implement → adversarial audit → verdict → fix
→ merge. The design note is written and reviewed **before** any code; three blockers were caught
there in M1, including cost being world-readable.

Agents run headless through `scripts\agent\run-agent.cmd <prompt> [model] [effort]`, which writes
its log under `.agent-runs/` and a completion marker to `.agent-runs/LAST-RUN.done`
(`exit|prompt|log`). Builder runs on `gemini-3.8-flash-high`; the adversarial audit runs on
`claude-opus-4-6-thinking`, deliberately a different model family — it caught a race condition the
builder's own family had introduced. Claude models reject `--effort`; the wrapper omits it.

`scripts/audit/check-invariants.mjs` encodes architectural invariants as executable checks and runs
in CI. Every audit finding that can be expressed mechanically should become one.
