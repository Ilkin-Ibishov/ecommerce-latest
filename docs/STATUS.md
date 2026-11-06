# Project status — handoff

Last updated: 2026-11-06. Written as the entry point for a new session. Everything referenced here
lives in this repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session

A CI run is in flight, started at the end of the last session, independent of any chat session:
**[run 42272107493](https://github.com/Ilkin-Ibishov/ecommerce-latest/actions/runs/42272107493)**
on branch `claude/davam-840a9f`, dispatched after merging `chore/ci-first-run-fixes` (see below).
It may already be finished by the time you read this.

```bash
gh run view 42272107493 --repo Ilkin-Ibishov/ecommerce-latest --json status,conclusion
```

- If `conclusion: success` — the integration tier is fully green for the first time ever. Update
  this file's state section to say so and move to open item 5's remaining sub-items (the
  security-definer-view decision, the June-era-secrets note is now resolved).
- If `conclusion: failure` — read the log (`gh run view 42272107493 --repo Ilkin-Ibishov/ecommerce-latest --log-failed`),
  diagnose the same way the previous session did (see "Two failure modes" below), and fix. Given
  the previous round took 3 iterations (Playwright runner image, `SESSION_SECRET` wiring, then 8
  real test bugs), a clean run on this attempt is plausible but not guaranteed.
- If `status: in_progress` — wait for it; don't dispatch a second run on top of it.

## Where to start

1. `AGENTS.md` — house rules for every agent session
2. `docs/tasks/` — specs, architect-owned. Agents read, never edit
3. `docs/design-notes/` — the implementer's proposals, written before code
4. `docs/audits/` — every review and every agent's own notes, in order
5. `.agents/rules/` — domain invariants

## State

**M1, M2a, M2b and M2c are all complete and merged on local `main`, together with
`chore/ci-repair`.** `main` itself is still local-only and unpushed (open item 4).

**`claude/davam-840a9f` is a clean fast-forward ahead of `main`** (confirmed:
`git merge-base --is-ancestor main claude/davam-840a9f` holds) and carries this session's
Supabase bootstrap + CI work (item 5) on top of everything `main` has. It is pushed to `origin`;
`main` is not (open item 4). Fast-forwarding local `main` to `claude/davam-840a9f` once CI is
green is a reasonable next step, not yet done.

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
5. **The test Supabase project is bootstrapped, all three GitHub secrets point at it, and CI has
   run the integration tier against it three times, fixing real bugs each round.** State as of
   end of session (2026-11-06), in order of what happened:
   - Bootstrapped `ecommerce-warehouse` (ref `jcvsnoiacrknzejouxah`, ap-south-1, Postgres 17) —
     the first time any migration in this repository has run against a real Postgres. 41 tables,
     all RLS-enabled. Full account, including the discovery that `schema.sql` and
     `supabase/migrations/` are each independently incomplete and `products.brand` existed only
     on some untracked real project, is in `docs/audits/test-supabase-project-bootstrap.md`.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` now all point at
     `jcvsnoiacrknzejouxah` (repointed from stale June-era values).
   - Added `workflow_dispatch` to `.github/workflows/test.yml` so the integration tier can run
     without pushing to `main` or opening a PR.
   - **Round 1**: `integration-e2e` failed before any test ran — `ubuntu-latest` moved to 26.04,
     unsupported by Playwright 1.60.0. Fixed: pinned that job to `ubuntu-24.04`.
   - **Round 2**: failed on `Missing required environment variable: SESSION_SECRET` — the "Run
     API integration tests" step had no `env:` block at all (only the separately-started API
     server got the secret). Fixed: added it to that step too.
   - **Round 3**: ran for real — **1119 of 1146 tests passed**. The 8 failures were diagnosed,
     delegated to the project's own AGY builder agent (`prompts/chore-ci-first-run-fixes.md`,
     branch `chore/ci-first-run-fixes`), audited, and merged into `claude/davam-840a9f`: a missing
     `comments.rating` column (migration applied), a stale `admin-routes.test.ts` route list, a
     `loginTestUser` argument-order bug, two test files that assumed phantom hand-created seed
     data (now self-provisioning their own fixtures), and a missing `OTP_VERIFY_FIXED` CI toggle.
     Full writeup: `docs/audits/chore-ci-first-run-fixes-notes.md`.
   - **Round 4 is in flight** — see "Start here" at the top of this file for the run link and
     what to do with its result.

   Remaining after round 4 resolves:
   - decide the ERROR-level `product_variant_public_availability` security-definer-view finding
     from `get_advisors` — may be intentional (C5's whole point is anon-safe exposure) but needs
     an explicit decision recorded, not silence
   - `main` is still behind `claude/davam-840a9f` (see State above) — fast-forward it once CI is
     green, or decide not to and say why

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
  its way is prose in `AGENTS.md`. Re-add it scoped to the test project's ref now that it exists
  (`jcvsnoiacrknzejouxah`) — not yet done.
- Launching `scripts\agent\run-agent.cmd` from a Bash tool via `cmd.exe /c "scripts\agent\run-agent.cmd ..."`
  silently no-ops: it prints the Windows banner and returns exit 0, but never creates `.agent-runs/`
  and never starts `agy.exe`. Launch it from PowerShell directly instead
  (`& "scripts\agent\run-agent.cmd" "prompts\<file>.md"`, run in background) — that one actually
  works. Confirmed `.agent-runs/` appearing within a few seconds as the signal it's really running.

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
