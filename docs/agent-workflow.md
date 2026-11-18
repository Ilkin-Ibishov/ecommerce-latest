# How work runs here

Durable process, not status. `docs/STATUS.md` says what is true today and is rewritten every
session; this file says how the project is worked and changes rarely. One fact lives in one place:
where another file owns a topic, this file points to it instead of repeating it.

## Where things are

1. `AGENTS.md` — house rules for every agent session. Scoped `AGENTS.md` in `artifacts/api-server/`,
   `artifacts/store/` and `supabase/`
2. `docs/tasks/` — specs, architect-owned. Agents read, never edit
3. `docs/design-notes/` — the implementer's proposals, written before code
4. `docs/audits/` — every review and every agent's own notes, in order
5. `docs/archive/{tasks,design-notes,audits,prompts,planning}/` — the same kinds of file for
   merged phases; `docs/archive/status/` holds superseded handoffs. `.ignore` keeps them out of project-wide search so a grep returns live guidance
   only; search them by path (`rg term docs/archive`) or start from their `INDEX.md`. When a phase
   merges, `git mv` its spec, design note, audits and prompts there in one commit and run
   `pnpm run docs:index`
6. `.claude/skills/` — `session-start` (the orchestrator's role and the rules this project learned
   the hard way), `testing-tiers`, `e2e-diagnose`, `locale-key-add`, `inventory-domain` and others
7. `docs/knowledgebase/` — operational facts not tied to one phase: Supabase projects and what the
   harness blocks on them, CI/E2E gotchas, Windows local-dev quirks. Index in its `README.md`

`.kiro/` and `ltm/` were removed on 2026-11-18 (`ad17c6d`). Recover a Kiro spec with
`git show 9d885f7:.kiro/specs/<name>/requirements.md`, a steering file with
`git show 4b59f51:.kiro/steering/<name>.md`, the LTM tool with `git show 506ebe4:ltm/bin/ltm.py`.
Do not reinstate the hook — AGENTS.md forbids external pre-invocation hooks.

## The pipeline

Spec → design note → architecture review → implement → adversarial audit → verdict → fix → merge.
The design note is written and reviewed **before** any code. The rules for each step — the design
note's two questions, how to brief the auditor, accepting a round against the diff — are in the
`session-start` skill and `builder-round-accept`.

`scripts/audit/check-invariants.mjs` encodes architectural invariants as checks and runs in CI.
Every audit finding that can be expressed mechanically should become one (skill
`invariant-from-finding`).

## The builder (AGY CLI)

Agents run headless through `scripts\agent\run-agent.cmd <prompt> [model] [effort]`, which writes a
log under `.agent-runs/` and a completion marker to `.agent-runs/LAST-RUN.done` (`exit|prompt|log`).

- **Launch from PowerShell**, `& "scripts\agent\run-agent.cmd" "prompts\<file>.md"`, in the
  background. Through Bash (`cmd.exe /c ...`) it silently no-ops: banner, exit 0, no `agy.exe`, no
  `.agent-runs/`. A new log in `.agent-runs/` within ~10 s is the signal it really started.
- **Model quota.** All non-Gemini models share one account-level quota. The builder always runs on
  `gemini-3.8-flash-high`; the adversarial audit is the one job worth the shared quota, one attempt
  per phase. Audit prompts say **work directly, spawn no subagents** — one fanned out, hit rate
  limits and produced nothing. A run that dies can resume with `--conversation <id>` or `--continue`.
- For Gemini, effort is part of the model id (`-high`/`-medium`/`-low`); `--effort max` with a
  `-high` model is rejected. The family tops out at `-high`.
- `--output-format json` returns `finished_reason` (`print_timeout`, `interrupted`, `error`), absent
  on a normal finish. The wrapper captures only the exit code, so a quota death looks like a bare
  `exit 3` until you read the log.
- `agy agents` lists nothing: `.claude/agents/auditor.md` reaches the model only because the prompt
  tells it to adopt that file. Whether scoped-rule loading works in the CLI is unverified.
- **Open security items (not done):** `agy mcp list` shows the `supabase` server at account scope,
  so a builder can reach every Supabase project and only prose stops it — re-add it scoped to the
  test project (`jcvsnoiacrknzejouxah`) or a branch. The same listing prints a plain-text API key in
  the `google-developer-knowledge` server header — move it to an environment variable.
- **Not built yet:** the CLI supports `--output-format stream-json` (live steps; verified on
  v1.5.9), `--conversation` resume, `--json-schema` structured reports and `--mode plan` (no
  edits — would make the design-note gate mechanical). A wrapper using them would let the
  orchestrator answer the builder's questions and stop a wrong direction early. Builder work under
  `scripts/`; reference `https://antigravity.google/docs/cli/headless.md`.

## Operational notes

- **A stuck-looking builder is often not stuck.** One logged ~65 identical "waiting for typecheck"
  lines for 25 minutes and then finished cleanly. Read `.agent-runs/LAST-RUN.done` and the branch's
  commits before concluding anything.
- **The builder pushes at the end even when the prompt says "Do not push".** Check
  `origin/<branch>` before trusting your local view.
- **A force-push and `Stop-Process` on another process are refused** by the permission classifier
  until the owner approves in chat. Workaround for a rebase: push the rebased history to a **new**
  branch, run CI there, force-push the canonical branch after the owner's yes.
- **`git -C <other-worktree> rebase origin/main` is allowed** (`reset --hard` is not).
- **`sed` and `perl` are unreliable here for non-ASCII text and regex metacharacters** — several
  attempts silently matched nothing while reporting success. Use a short Node script that finds the
  line by an ASCII anchor and prints before and after.
- **CI triggers itself on a push to `main`.** Check that run too — merging is not the end.
- **`integration-e2e` runs one at a time** (concurrency group `supabase-test-project`), and
  GitHub keeps only one *pending* run per group: a newer queued run cancels the older pending one.
  After several merges or pushes in a row, check `main`'s latest run and rerun it if cancelled.
- **A session in a worktree cannot write another worktree's files** (a hook refuses). For a
  second branch, `git switch -c <branch> origin/main` in the same worktree with a clean tree.
- **`git revert -q <sha>` once made no commit and printed nothing**, and the `--amend` that
  followed rewrote the previous commit's message instead. Check `git log -1` before amending.
- **Read-only audit sub-agents are worth it** (clean context, own worktree, 60–130 s each). Check
  their top findings against the code before repeating them.
- E2E failures: skill `e2e-diagnose`. Locale assertions: skill `locale-key-add`. Locator and SPA
  timing traps: `docs/knowledgebase/ci-testing-gotchas.md`.
