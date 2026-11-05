# Project status — handoff

Last updated: 2026-11-05. Written as the entry point for a new session. Everything referenced here
lives in this repository; nothing important is only in a chat transcript.

## Where to start

1. `AGENTS.md` — house rules for every agent session
2. `docs/tasks/` — specs, architect-owned. Agents read, never edit
3. `docs/design-notes/` — the implementer's proposals, written before code
4. `docs/audits/` — every review and every agent's own notes, in order
5. `.agents/rules/` — domain invariants

## State

**M1, M2a, M2b and M2c are all complete and merged on local `main`, together with
`chore/ci-repair`.** Nothing has been pushed: `main` is 121 commits ahead of `origin/main`.

Verified on 2026-11-05 at the merge point:

| Check | Result |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `pnpm run test:unit` | 670 tests, 58 files, exit 0 |
| `pnpm run audit:invariants:strict` | 14 checks, 0 violations, baseline empty |

### What each phase delivered

- **M1** — variant layer; stock lives only on variants; append-only `stock_movements` with a
  before-insert apply trigger and an immutability trigger; roles with cost hidden from staff.
- **M2a** — suppliers, goods receipts, weighted-average cost as a rebuildable projection
  (`stock_movement_costs`) replayed by `posting_date`, margin report, cost isolation behind RLS.
- **M2b** — stocktake and the opening count: per-line system snapshots captured by trigger, delta
  (never absolute-set) corrections, blind counting, multi-counter reconciliation, shrinkage.
- **M2c** — reservations and deposits: availability enforced inside the database, atomic multi-item
  order decrement, pay-and-collect fulfilment, `effective_status` computed once, three-number
  availability view, public availability view for `anon`.

Per-phase detail lives in `docs/audits/m2*-implementation-notes.md` and the design notes.

## Next

**M3** — counter sale, barcode flow, offline queue, and a minimal bill of materials.

**M3 is gated on open item 3 below.** If a certified fiscal device is mandatory for cash retail,
the counter-sale design is cancelled and the system stays back-office only. Do not start M3 before
that answer arrives; it is roughly a quarter of the remaining engineering.

Before M3, the highest-leverage work is open item 5 — the test Supabase project and CI.

## Open

**Business — blocking go-live, not engineering. None of these moved between 29 Oct and 5 Nov:**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
   Engineering completing M3 and M4 still leaves a finished, empty system.
2. Design-partner agreement and the monthly price.
3. The accountant's written answer on fiscal receipt requirements. Gates M3.

**Technical:**

4. `main` is local-only and unpushed.
5. **No migration in this repository has ever been executed against a real Postgres**, and CI's
   integration tier has been failing since 1 July 2026. The SQL — five phases, several thousand
   lines of PL/pgSQL — is checked only by a TypeScript re-implementation of its logic. The M2a
   blocker (`is_admin()` inside a `SECURITY DEFINER` function called with the service-role client,
   which made every new RPC raise) lived precisely in that untested seam and no green test saw it.

   Remaining work, in order:
   - create a dedicated test Supabase project (never point CI at production)
   - apply the migrations: `npx supabase db push --remote=<ref|url> --include-all --dry-run` first,
     then without `--dry-run`. **The flag is `--remote`, not `--db-url`** — verified against CLI
     v3.0.0 help. A scoped personal access token with `database_write` is enough; prefer it to a DB
     password.
   - run `npx supabase db advisors` afterwards and fix what it reports
   - check the Data API settings: on a fresh project, tables created by SQL are not necessarily
     exposed to `anon`/`authenticated`, and several integration tests read PostgREST directly
   - point the three GitHub secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`) at the new project. They currently hold June-era values for an
     unidentified project.
   - expect the first red run to be auth configuration (email confirmation, OTP rate limits) rather
     than schema

   Already done: `SESSION_SECRET` exists as a GitHub secret and is wired into `test.yml`'s API
   server step; the stale assertion in `otp-verify-500.exploration.test.ts` is fixed.

6. **M2b has had no independent adversarial audit from a different model family.** Its audit ran on
   the builder's own family (clean context, shared blind spots) after the quota described below ran
   out. Re-audit it when the quota resets. The architect's own pass found four defects there,
   including a blocker, so it is not unreviewed — only single-family reviewed.
7. Blind counting is not tamper-proof: a staff token can read `product_variants.on_hand` directly,
   because the storefront needs that column readable. Recorded in `.agents/rules/inventory.md`.
8. Open customer questions that decide which UI ships first: is the scanner in daily use or dormant?
   Do colour variants share one barcode? What is the ~10% of goods without barcodes?
9. `SESSION_SECRET` must be set in every deployed environment before the next deploy — the API
   refuses to start without it.

## How work runs here

Phases go: spec → design note → architecture review → implement → adversarial audit → verdict → fix
→ merge. The design note is written and reviewed **before** any code.

Agents run headless through `scripts\agent\run-agent.cmd <prompt> [model] [effort]`, which writes a
log under `.agent-runs/` and a completion marker to `.agent-runs/LAST-RUN.done` (`exit|prompt|log`).

`scripts/audit/check-invariants.mjs` encodes architectural invariants as executable checks and runs
in CI. Every audit finding that can be expressed mechanically should become one. There are 14.

### Model quota — read before planning an audit

All non-Gemini models share **one account-level quota**, not a per-model one. On 2026-11-05 it was
exhausted across `claude-opus-4-6-thinking`, `claude-sonnet-4-6` and `gpt-oss-120b-medium`
simultaneously, resetting roughly 10 November. Only the Gemini family remained available.

Consequences for planning:

- The builder always runs on `gemini-3.8-flash-high`. Never spend the shared quota on building.
- The adversarial audit is the one job worth that quota. One attempt per phase.
- A run that dies mid-way can be resumed with `--conversation <id>` or `--continue`. The M2b audit
  died on quota and was restarted from scratch, which wasted the remainder.
- Audit prompts must tell the auditor to **work directly and not spawn subagents** — the first M2b
  audit attempt fanned out, hit rate limits, and produced nothing.

### AGY CLI facts worth knowing (verified against v1.5.0)

- `--output-format json` returns a `finished_reason` field (`print_timeout`, `interrupted`, `error`),
  absent on a normal finish. The wrapper currently captures only the exit code, so a quota death
  looks like a bare `exit 3` until you read the log. Worth switching.
- `--mode plan` prevents file edits mechanically. The design-note gate is currently enforced only by
  prompt text; plan mode would make it structural.
- For Gemini, effort is **part of the model id** (`-high`/`-medium`/`-low`). Passing `--effort max`
  with `gemini-3.8-flash-high` is rejected as a conflict. The family tops out at `-high`.
- `agy agents` lists nothing, so `.agents/agents/auditor.md` is **not** registered as a CLI agent.
  The auditor persona reaches the model only because the prompt tells it to adopt that file. Whether
  `.agents/rules/*.md` trigger-loading works in the CLI is likewise unverified.
- `agy mcp list` shows the `supabase` server configured at **account scope** (no `project_ref`), so
  a builder run can reach every Supabase project including production. The only thing standing in
  its way is prose in `AGENTS.md`. Re-add it scoped to the test project's ref once that exists.

### Two failure modes this project has actually produced

Both are worth re-reading before writing a spec or a builder prompt.

**1. Precise but incomplete rules.** Five of the six findings in the M2b adversarial audit were
faithful implementations of instructions that were exact and wrong. The posting-date guard was
written against a backdating abuse and made every ordinary stocktake unpostable, because the normal
flow sets the business date before any count line exists. The resolution-staleness check compared
creation timestamps and so could not see an edited line, because a separate earlier decision had
established that an edit keeps its line. Each rule was right alone and wrong together.

So for every non-trivial rule, answer two questions in writing: **how does it behave in the ordinary
flow**, and **which earlier decision does it intersect**. `docs/tasks/warehouse-m2c-reservations.md`
§11 states this as a requirement on the design note, and it should stay in every later spec.

**2. Views bypass RLS, and `authenticated` is not staff.** `reservations_view` was created with
owner rights (the Postgres default) and granted to `authenticated`, which in this product includes
every signed-in **shopper**. Any customer with an account could read every deposit — names, phone
numbers, agreed prices, amounts paid — straight from PostgREST, while the underlying table's RLS was
correct and irrelevant. Fixed by `security_invoker = true` (migration `20261105200000`), with the
companion view's `authenticated` grant revoked and an invariant added
(`no-sensitive-columns-in-exposed-views`).

The lesson is the question, not the fix: whenever a grant names `anon` or `authenticated`, ask who
actually holds that role in this product.
