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

**M2c is complete on `m2c/reservations` and verified. It has not been merged.**  
(Preceding phase M1 and M2a are merged on local `main`; M2b is complete on `m2b/stocktake`.)

Verified locally on 2026-11-04:

| Check | Result |
|---|---|
| `pnpm run typecheck` | exit 0 across all 5 workspace projects |
| `pnpm run test:unit` | 665 tests, 57 files, exit 0 |
| `pnpm run audit:invariants:strict` | 13 checks, 0 violations, baseline empty |

The empty baseline remains preserved across all 13 invariant checks, including the newly added
`no-private-columns-on-anon-grants` and `no-on-hand-reads-on-storefront` invariants.

### What M2c delivered

- **Atomic multi-item order stock decrement.** `decrement_order_stock` locks variant rows in ascending order,
  verifies availability for all lines, and writes movements in a single database transaction, replacing JavaScript loops.
- **Single-transaction pay-and-collect fulfilment.** `fulfil_reservation` applies final payments and fulfilment
  atomically, raising `ST015` naming shortfalls if full payment is not met.
- **Computed `effective_status`.** Computed once in SQL (`reservations_view`), mapping active holds past expiry
  to `expired` without altering physical status history or auto-releasing stock.
- **Unified availability view with deficit exposure.** `product_variant_availability` exposes on-hand,
  reserved quantity, clamped available quantity, and deficit quantity ($H < R$).
- **Anonymous token boundary.** `product_variant_public_availability` exposes only `variant_id, product_id, available_quantity`
  to `anon`, with automated invariant check `no-private-columns-on-anon-grants`.
- **Documented trigger bypass reasons.** Explicit trigger comments and `.agents/rules/inventory.md` entries
  documenting reasons that bypass availability checks (e.g. counter sale, physical stocktake corrections).
- **Storefront availability integration.** Public catalogue, search, product detail, quick-view, and checkout
  validate against `available_quantity` from `product_variant_public_availability`.
- **Counter deposit screen (< 1 min) & owner aged list.** Rapid staff deposit creation (`CreateDepositModal`),
  one-click "Pay & Collect" button, and owner aged holds list (`AgedReservationsList`) with release reasons.

### Decisions closed, and where the reasoning lives

| Decision | Where |
|---|---|
| Atomic order decrement locks variant rows ascending (C1) | `docs/design-notes/m2c-reservations.md` §8.3, `docs/audits/m2c-implementation-notes.md` §2 |
| Pay-and-collect fulfilment in one transaction (C2) | `docs/design-notes/m2c-reservations.md` §4, `docs/audits/m2c-implementation-notes.md` §2 |
| `effective_status` computed in database view (C3) | `docs/design-notes/m2c-reservations.md` §3, `docs/audits/m2c-implementation-notes.md` §2 |
| Availability view exposes clamped available and deficit (C4) | `docs/design-notes/m2c-reservations.md` §4, `docs/audits/m2c-implementation-notes.md` §2 |
| Anon token restricted to public availability view (C5) | `docs/design-notes/m2c-reservations.md` §5, `docs/audits/m2c-implementation-notes.md` §2 |
| Trigger bypass reasons and fulfilment ordering (C6) | `.agents/rules/inventory.md`, `docs/audits/m2c-implementation-notes.md` §2 |
| Staff payment recording vs owner price/release control | `docs/design-notes/m2c-reservations.md` §8.1, `docs/audits/m2c-implementation-notes.md` §3 |
| Mandatory release reason for cash drawer auditability | `docs/design-notes/m2c-reservations.md` §8.2, `docs/audits/m2c-implementation-notes.md` §3 |

## Next

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
