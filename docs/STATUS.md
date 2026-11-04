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

**M2a is complete on `m2/receiving-cost` and verified after adversarial audit fixes. It has not been merged.**  
(Preceding phase M1 is complete on `m1/variants-ledger`.)

Verified locally on 2026-11-04:

| Check | Result |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `pnpm run test:unit` | 582 tests, 45 files, exit 0 |
| `pnpm run audit:invariants:strict` | 9 checks, 0 violations, baseline empty |

The empty baseline remains preserved across all 9 invariant checks, including the newly added
`security-definer-service-role-privileges` invariant.

### What M2a delivered

- **Goods receipts and suppliers.** Drafts, line entry, posting, and full reversal (`goods_receipts`,
  `goods_receipt_lines`, `suppliers`). Posting generates immutable stock movements with
  `reference_type = 'goods_receipt'` atomically under lock. Full reversal verifies that no received
  units were already consumed and raises actionable error `ST008` naming the receipt, variant, SKU,
  and consumed count if partially consumed.
- **Weighted-average cost (WAC) replay.** `recompute_variant_cost` replays stock movements ordered by
  `posting_date`, `created_at`, `id`. Excludes unvalued opening balances and unpriced movements from
  cost calculations. Replay concurrency is secured by collision-free 64-bit integer advisory
  transaction locks (`pg_advisory_xact_lock(int, int)`).
- **Cost boundary isolation.** `variant_costs` and `goods_receipt_lines.unit_cost` are hidden from
  staff and accessible only by admins/owners. Database RPCs use Postgres execute privileges
  (`REVOKE ... FROM public, anon, authenticated; GRANT ... TO service_role`) rather than runtime
  `auth.uid()` checks in function bodies.
- **Granularity-corrected margin reporting.** Excludes unpriced outflows from revenue and COGS
  (preventing phantom losses), tracking them separately as `unpriced_units_out` across categories,
  variants, and on the UI report banner.
- **Operational integrity tooling.** `rebuild_on_hand(variant)` and `verify_stock_integrity()`.
  `rebuild_on_hand` recomputes both on-hand stock and cost projection atomically in a single transaction.
- **Tenant negative stock control.** `allow_negative_stock` setting in `site_settings`, enforced via
  `BEFORE INSERT` trigger on `stock_movements`, recording `negative_stock_override = true` on any
  movement that drives stock below zero.
- **Unit of Measure (UoM) immutability.** Prevents changing `uom` on variants once stock movements
  exist in the ledger.
- **Architectural invariant.** `security-definer-service-role-privileges` in
  `scripts/audit/check-invariants.mjs` verifying privilege boundaries and prohibiting `auth.uid()`
  dependencies in service-role RPCs.

### Decisions closed, and where the reasoning lives

| Decision | Where |
|---|---|
| RPC authorisation via Postgres privileges, not `auth.uid()` in body | `docs/audits/m2a-fix-notes.md` §F1 |
| `BEFORE INSERT` trigger stamping `negative_stock_override` for negative stock | `docs/audits/m2a-fix-notes.md` §F2 |
| Unpriced sales excluded from margin and reported as `unpriced_units_out` | `docs/audits/m2a-fix-notes.md` §F3 |
| Reversal refusal on consumed goods with descriptive error diagnostic | `docs/audits/m2a-fix-notes.md` §F4 |
| Two-argument 64-bit integer advisory locks for variant cost replay | `docs/audits/m2a-fix-notes.md` §F5 |
| Cost projection recomputation coupled to `rebuild_on_hand` | `docs/audits/m2a-fix-notes.md` §F6 |
| Privilege-level security blocking PostgREST staff calls | `docs/audits/m2a-fix-notes.md` §F7 |
| Quick View property test timeout stabilization | `docs/audits/m2a-fix-notes.md` §Flaky-Test |

## Next

**M2b** — stocktake count sheets, count-entry UI, optimistic concurrency on observed on-hand,
and reservations (deposits) ledger.

Carried forward into M2b:

- Stocktake count sheets and count entry workflow.
- Stocktake optimistic concurrency: accept `observed_on_hand` with the count and reject on mismatch,
  preventing silent overwrite of sales that occurred while counting.
- Reservations (deposits) ledger: allocating stock without movement ledger consumption until
  fulfillment or pickup.

**M3** — counter sale, barcode flow, and a minimal bill of materials. Build parent / component /
quantity plus one produced flag.

## Open

**Business — blocking go-live, not engineering:**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
2. Design-partner agreement and the monthly price.
3. The accountant's written answer on fiscal receipt requirements, which gates the counter-sale work.

**Technical:**

4. `main` is merged only up to the chore batches; `m1/variants-ledger` and `m2/receiving-cost` are not
   merged to `main` and nothing is pushed.
5. The Supabase project behind the CI secrets has not been confirmed as separate from production, so
   no migration has been applied to any remote database. The integration tier runs only in CI.
6. Is the first customer's scanner in daily use or dormant? Do colour variants share one barcode?
   What is the ~10% without barcodes? The model covers every answer; the answers decide which UI ships first.
7. `SESSION_SECRET` must be set in every deployed environment before the next deploy — the API now
   refuses to start without it, which is correct but will surprise a deploy that has not set it.

## How work runs here

Phases go: spec → design note → architecture review → implement → adversarial audit → verdict → fix
→ merge. The design note is written and reviewed **before** any code; three blockers were caught
there in M1, including cost being world-readable.

Agents run headless through `scripts\agent\run-agent.cmd <prompt> [model] [effort]`, which writes
its log under `.agent-runs/` and a completion marker to `.agent-runs/LAST-RUN.done`
(`exit|prompt|log`). Builder runs on `gemini-3.8-flash-high`; the adversarial audit runs on
`claude-opus-4-6-thinking`, deliberately a different model family.

`scripts/audit/check-invariants.mjs` encodes architectural invariants as executable checks and runs
in CI. Every audit finding that can be expressed mechanically should become one.
