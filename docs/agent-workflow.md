# How work runs here

Durable process, not status. This file is the counterpart to `docs/STATUS.md`: STATUS.md says what
is true today and is rewritten every session, this file says how the project is worked and changes
rarely. Moved out of STATUS.md on 2026-11-17 so that a session start no longer reads it in full.

## Where to start

`.kiro/` was an earlier tool's configuration and is gone as of 2026-11-18: `specs/` (1.2 MB, 77
files) in `ad17c6d`, then `steering/` (19 files) and `hooks/` (4) in the commit after it. Nothing
in a Claude session ever read any of it; the only references left were provenance comments in the
SEC-00x test files. Recover a spec with `git show 9d885f7:.kiro/specs/<name>/requirements.md`, a
steering file with `git show 4b59f51:.kiro/steering/<name>.md`.

`ltm/` went with it: a 951-line Python tool that logged file-touch events and "checkpoints" to
JSONL under `ltm/store/`, driven by the Kiro post-turn hook. Its store was never committed, so
only the empty machinery was in the repo, and the hook that fed it has been gone since Kiro.
What it recorded is better read from `git log` (structural) and from this file plus STATUS.md
(semantic). Recover it with `git show 506ebe4:ltm/bin/ltm.py`. Do not reinstate the hook —
AGENTS.md forbids external pre-invocation hooks for the latency they add.



1. `AGENTS.md` — house rules for every agent session
2. `docs/tasks/` — specs, architect-owned. Agents read, never edit
3. `docs/design-notes/` — the implementer's proposals, written before code
4. `docs/audits/` — every review and every agent's own notes, in order
5. `.claude/skills/` — skills, including the inventory domain rules and the testing tiers
6. `docs/knowledgebase/` — cross-cutting operational lessons (Supabase project facts, harness
   tool restrictions, Playwright/SPA gotchas, Windows local-dev quirks) that aren't tied to one
   phase. Index in its `README.md`
7. The per-directory `AGENTS.md` files (`artifacts/api-server/`, `artifacts/store/`,
   `artifacts/store/`) — runbooks and scoped rules added on `antigravity-development`

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

### AGY CLI facts worth knowing (first verified against v1.5.0; rechecked on v1.5.9, 2026-11-15)

- `--output-format json` returns a `finished_reason` field (`print_timeout`, `interrupted`, `error`),
  absent on a normal finish. The wrapper currently captures only the exit code, so a quota death
  looks like a bare `exit 3` until you read the log. Worth switching.
- `--mode plan` prevents file edits mechanically. The design-note gate is currently enforced only by
  prompt text; plan mode would make it structural.
- For Gemini, effort is **part of the model id** (`-high`/`-medium`/`-low`). Passing `--effort max`
  with `gemini-3.8-flash-high` is rejected as a conflict. The family tops out at `-high`.
- `agy agents` lists nothing, so `.claude/agents/auditor.md` is **not** registered as a CLI agent.
  The auditor persona reaches the model only because the prompt tells it to adopt that file. Whether
  scoped-rule loading works in the CLI is likewise unverified.
- `agy mcp list` shows the `supabase` server configured at **account scope** (no `project_ref`), so
  a builder run can reach every Supabase project including production. The only thing standing in
  its way is prose in `AGENTS.md`. Re-add it scoped to the test project's ref now that it exists
  (`jcvsnoiacrknzejouxah`) — not yet done.
- Launching `scripts\agent\run-agent.cmd` from a Bash tool via `cmd.exe /c "scripts\agent\run-agent.cmd ..."`
  silently no-ops: it prints the Windows banner and returns exit 0, but never creates `.agent-runs/`
  and never starts `agy.exe`. Launch it from PowerShell directly instead
  (`& "scripts\agent\run-agent.cmd" "prompts\<file>.md"`, run in background) — that one actually
  works. Confirmed `.agent-runs/` appearing within a few seconds as the signal it's really running.

### How the builder should be driven — proposed 2026-11-15, not yet built

Today `run-agent.cmd` sends one prompt, captures text, and exits: the log appears only at the end,
the conversation is lost, and the builder cannot ask anything. The CLI already supports better.

| Want | Flag | Checked |
|---|---|---|
| See each step as it happens | `--output-format stream-json` — NDJSON: one `init` (with `conversation_id`), `step_update` per tool call or response, one `result` | Run on v1.5.9: works |
| Continue the same session | `--conversation <id>` or `-c` with a new `-p` | Documented; not tried here. An old changelog entry says resuming once reprinted the whole history |
| A report that cannot omit fields | `--json-schema <file>` with `--output-format json`; parsed result in `structured_output` | Documented; not tried |
| Plan before any edit | `--mode plan` | Flag exists; not tried |
| Questions in the middle of a run | `--input-format stream-json` (turns on stdin) or `agy acp` (ACP over stdio). The tool list includes `ask_question` | Exists; needs a driver that is not written |

The loop this allows, in order of effort: (1) a plan turn that returns the plan and the builder's
questions as structured output; (2) the orchestrator answers and resumes the same conversation;
(3) the build turn streams, so a wrong direction is stopped in minutes, not after forty; (4) audit
findings go back into the same conversation instead of a new cold prompt. Mid-run questions (ACP)
only if this is not enough.

Changing the wrapper is builder work under `scripts/`. No prompt for it exists yet. Try resuming on
a throwaway prompt before relying on it. Official reference:
`https://antigravity.google/docs/cli/headless.md`.

Two things seen while checking:

- The Supabase MCP server is still configured at account scope in `agy`, so the builder **can**
  reach the database today; only prose stops it. If it is to probe the test project (rolled-back
  `pg_temp` objects, read-only queries), re-add the server scoped to `jcvsnoiacrknzejouxah`, or
  point it at a Supabase branch. Applying a migration stays with the orchestrator and the owner.
- `agy mcp list` prints an API key that is stored in plain text in one server's header
  (`google-developer-knowledge`). Move it to an environment variable. The value is not recorded here.

### Three failure modes this project has actually produced

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

**3. Present and plausible is not correct (M4, 2026-11-15).** Three defects passed a careful read of
the diff and failed on contact: a view migration Postgres refused (42P16), two functions that raised
on their first call (42702), and four routes that answered 500 because their validation schemas
named fields no function returned. A fourth — an unlimited item removed from the cart — was missed
because the list of readers came from a grep for `available_quantity` and the checkout read the
same value as `available`. The builder's notes were wrong in the same way: they reported one deleted
test where the diff had four.

The lesson is the habit, not the four fixes: execute SQL on Postgres before applying it (temporary
objects in a rolled-back transaction), compare a schema with the thing it describes, follow a value
through the code rather than its name, and accept a round against the diff. The mechanical parts
are now rules: `supabase/AGENTS.md`, `.claude/skills/testing-tiers/`, `AGENTS.md` ("Audit
interface"), and the orchestrator prompt.

## Lessons that cost a session to learn

Each of these was written by the session that paid for it. They are here because they keep being
relevant after the session that learned them is archived.

### The stale-locale trap — read this before writing an E2E assertion

Before round 1, `main` had **no `Admin.Counter` dictionary block at all** (`az.ts` and `en.ts` were
1175 lines; they are 1263 now). The till's strings were **hardcoded Azerbaijani literals**, and
`counter-sale.spec.ts` asserted them directly. Round 1 correctly replaced them with `t()` calls and
added the dictionary — which turned six assertions into strings that can never match, because **the
admin UI runs in English in that spec** (its own `loginAsAdmin` waits for "Dashboard" and "Sign In
with Phone"). CI run 43852791362 failed on the first one, `getByRole("heading", { name: "Kassa" })`.

Fixed in `a708bbc`: six accessible names and one regex moved to the `en` values, with a comment in
the spec saying why. No assertion removed or weakened.

Three lessons worth keeping:
- **When a round replaces a hardcoded literal with `t()`, every E2E assertion on that literal must
  move to the locale the spec actually runs in.**
- **Verify the premise of an audit finding, not only the finding.** Round 2's audit cleared those
  selectors carefully — against the **az** dictionary, which is not what the page renders.
- **A repeated test name does not mean a repeated cause.** The same test was called "flaky" on
  `fix/m4-follow-ups`, but that branch carried the *untranslated* till, so it matched the literals and
  failed on timing. Two unrelated bugs, one name.

### Operational notes from this session

- **A force-push is refused by the permission classifier** until the owner approves it in chat. The
  cheapest workaround: push the rebased history to a **new** branch and run CI there, then force-push
  the canonical branch once the owner says yes. Nothing is lost either way.
- **`Stop-Process` on another process is also refused.** Do not plan around killing things.
- **A stuck-looking AGY builder is often not stuck.** Its log filled with ~65 identical lines ("I will
  wait for the typecheck process to complete") for 25 minutes and then finished cleanly with every
  commit and its notes. Read `.agent-runs/LAST-RUN.done` and the branch's commits before concluding
  anything; killing it would have discarded finished work.
- **The builder pushes at the end even when the prompt says "Do not push".** Check `origin/<branch>`
  before assuming your local view is current.
- **`gh run download <id> -n playwright-report` is the fastest way to diagnose an E2E failure.** The
  `error-context.md` holds the full accessibility tree at the moment of failure — that is what showed
  the page rendering perfectly in English, which no amount of reading the diff would have revealed.
- **`sed` and `perl` are unreliable here for non-ASCII text and for patterns holding regex
  metacharacters** (Azerbaijani literals, `\d`, `/`): several attempts silently matched nothing while
  reporting success. What works is a short `node -e` script that finds the line by an ASCII anchor and
  replaces it by index, printing before and after.
- **`git -C <other-worktree> rebase origin/main` is allowed** (unlike `reset --hard`, which the
  classifier refuses). A 26-commit rebase ran clean and left that worktree usable.
- **CI triggers itself on a push to `main`.** Check that run too — merging is not the end of the
  verification.
- **Read-only audit sub-agents remain worth it** (Sonnet, clean context, own worktree, 60-130s each).
  Two ran in parallel on the two fix branches and both reports held up on spot-checks.
- **A handoff that is not on `main` is a handoff that gets lost.** The 2026-11-16 afternoon handoff sat
  unmerged on `docs/handoff-2026-11-16b`, so `main`'s `STATUS.md` was a full session out of date and
  this session nearly started from stale information. It was cherry-picked forward as `7393d45`. Put
  the handoff on `main`.
