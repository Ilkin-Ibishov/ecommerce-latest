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

**M2b is complete on `m2b/stocktake` and verified after architectural fix. It has not been merged.**  
(Preceding phase M1 and M2a are merged on local `main`.)

> [!WARNING]
> **The adversarial audit for M2b did not run.** The `claude-opus-4-6-thinking` run hit an account
> quota partway through and committed nothing; the quota resets in roughly six days. M2b has had the
> architect's review, local unit/property suites, and mechanical checks, but **not** an independent
> adversarial pass on a different model family. Do not list M2b as audited.

Verified locally on 2026-11-04:

| Check | Result |
|---|---|
| `pnpm run typecheck` | exit 0 across all 5 workspace projects |
| `pnpm run test:unit` | 598 tests, 49 files, exit 0 |
| `pnpm run audit:invariants:strict` | 10 checks, 0 violations, baseline empty |

The empty baseline remains preserved across all 10 invariant checks, including the newly added
`no-expected-quantity-on-staff-endpoints` invariant.

### What M2b delivered

- **Phone-first counting screen.** Rapid scan entry on mobile (`StocktakeCountPage.tsx`), barcode scanner
  input, blind counting (zero expected quantities or snapshots displayed to counters), rapid quantity
  stepper, and clean distinction between fixing a typo and recounting a shelf.
- **Authoritative on-hand snapshots and blind boundary.** Captured inside the database engine via
  `AFTER INSERT` trigger `trg_capture_stocktake_line_snapshot` into dedicated admin-only table
  `public.stocktake_line_snapshots`. Isolated from staff tokens by RLS and checked by automated invariant
  `no-expected-quantity-on-staff-endpoints`.
- **Multi-counter duplicate resolution algebra.** Multiple counters can scan the same variant. Distinct
  location notes automatically default to sum (`sum_defaulted`); conflicting or missing location notes
  strictly block posting (`ST009`) until explicitly resolved by the owner via `stocktake_resolutions`.
- **Typo fix vs. recount semantics (R1).** Editing a count line preserves the original observation timestamp
  and snapshot; recounting deletes the line and rescans, capturing a fresh snapshot under the trigger.
- **Store-wide opening count (§6).** Dedicated mode (`is_opening_count = true`) writing `opening_balance`
  movements without distorting weighted-average cost formulas. Wholesale costs recorded via
  `stocktake_opening_costs` populate `variant_costs.opening_cost`. Constrained by unique partial index
  `idx_single_posted_opening_stocktake` allowing at most one posted opening count in tenant history.
- **Atomic posting RPC (`post_stocktake`).** Single-transaction ACID posting. Locks header row `FOR UPDATE`,
  enforces `posting_date >= MAX(captured_at)` (`ST010`), reconciles multi-counter scans against latest
  snapshots (R5), inserts delta movements, and triggers scoped cost recomputation.
- **Owner review screen & shrinkage valuation (§7.3, §8).** Monetary variance review sorted by
  `ABS(variance_value) DESC`. Separates valued shrinkage in manat (`shrinkage_value`) from unvalued missing
  physical units (`unvalued_shrinkage_units`), preventing false reassurance on unpriced stock. Flags
  interleaved trade windows without halting store checkout.
- **Scoped snapshot queries & invariant enforcement.** Scoped snapshot fetching in `computeStocktakeVariance`
  strictly to lines of the stocktake under review (`.in("line_id", lineIds)`). Refuses to fall back to current
  on-hand on missing snapshot rows, preventing divergence between owner review and posting.

### Decisions closed, and where the reasoning lives

| Decision | Where |
|---|---|
| Typo edit preserves snapshot; recount rescans under trigger (R1) | `docs/design-notes/m2b-stocktake.md` §1 Q1, `docs/audits/m2b-implementation-notes.md` §1 |
| Owner-only `posting_date` bounded by `MAX(captured_at)` (R2) | `docs/design-notes/m2b-stocktake.md` §1 Q3, `docs/audits/m2b-implementation-notes.md` §1 |
| Location-based sum defaulting and collision blocking (R3) | `docs/design-notes/m2b-stocktake.md` §1 Q4, `docs/audits/m2b-implementation-notes.md` §1 |
| Honest limits of blind counting against direct on-hand reads (R4) | `docs/design-notes/m2b-stocktake.md` §1 Q1, `.agents/rules/inventory.md` |
| Delta composition against latest snapshot and interleaved trade flag (R5) | `docs/design-notes/m2b-stocktake.md` §1 Q5, `docs/audits/m2b-implementation-notes.md` §1 |
| Separation of monetary shrinkage and unvalued missing units (§7.3) | `docs/design-notes/m2b-stocktake.md` §1 Q3, `docs/audits/m2b-implementation-notes.md` §1 |
| Single-posted opening count constraint and opening cost carrier (§6) | `docs/design-notes/m2b-stocktake.md` §2, `docs/audits/m2b-implementation-notes.md` §1 |
| Snapshot query scoping & rejection of current-on-hand fallback | `docs/audits/m2b-fix-notes.md` §1 |

## Next

**M2c** — reservations (deposits) ledger.

Carried forward into M2c:

- Reservations (deposits) ledger: allocating stock to customer orders or deposits without movement ledger
  consumption until fulfillment or pickup.
- Available stock calculation (`on_hand - reserved`) across storefront availability checks and admin catalog.
- Handling deposit cancellations, stock releases, and expired holds.

**M3** — counter sale, barcode flow, and a minimal bill of materials. Build parent / component /
quantity plus one produced flag.

## Open

**Business — blocking go-live, not engineering:**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
2. Design-partner agreement and the monthly price.
3. The accountant's written answer on fiscal receipt requirements, which gates the counter-sale work.

**Technical — uncomfortable truths:**

4. `main` is local-only and unpushed; it now contains M1 and M2a. M2b is on `m2b/stocktake`.
5. No migration in this repository has ever been executed against a real Postgres. CI's integration
   tier has been failing since 1 July 2026 and its repair is deliberately postponed. The known work
   there: a dedicated test Supabase project with its three secrets, applying schema and migrations to
   it, `SESSION_SECRET` missing from `test.yml`'s API server step, and a stale assertion in
   `otp-verify-500.exploration.test.ts`.
6. Blind counting is not tamper-proof against a staff token reading `product_variants.on_hand`
   directly; the limit is recorded in `.agents/rules/inventory.md`.
7. Is the first customer's scanner in daily use or dormant? Do colour variants share one barcode?
   What is the ~10% without barcodes? The model covers every answer; the answers decide which UI ships first.
8. `SESSION_SECRET` must be set in every deployed environment before the next deploy — the API now
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
