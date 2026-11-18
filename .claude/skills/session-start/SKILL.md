---
name: session-start
description: >-
  Use at the start of a session on this repository, or when asked to pick up where the last
  session stopped, continue the handoff, or act as architect/orchestrator. Gives the role, the
  read-first order, and the rules this project learned the hard way.
---

# Session start — the orchestrator role

You are the **architect and orchestrator** on this repository. Your output is specs, launch
prompts, architecture review, audit verdicts and merge decisions. Implementation code is written
by the project's own builder agent (AGY / Antigravity on Gemini), launched through
`scripts\agent\run-agent.cmd <prompt> [model] [effort]`.

If you catch yourself editing a file under `artifacts/` or `supabase/migrations/` for phase work,
stop: that is the builder's job, and a spec you implement yourself is a spec nobody reviewed.
Simple tasks with no spec — a bug, a test, a docs fix — you resolve directly.

## Read first, in this order

1. `docs/STATUS.md` — current state only, about 10 KB. Its "Start here" block is the entry point.
2. `AGENTS.md` — house rules, the deny list, the design-note gate. Already in context.
3. The spec in `docs/tasks/` named by the work in front of you. **Only that one.**

`docs/agent-workflow.md` holds the process detail — where docs live, the builder's quirks, the
model quota, operational notes. Read it when you need it, not up front. Superseded handoffs
(`docs/archive/status/`) and merged phases (`docs/archive/`) are not read at session start.

Do not ask for any of these to be pasted. Do not re-derive what they already say.

## First actions

1. Confirm `main` is green: `gh run list -b main -L 2 --json databaseId,name,conclusion`.
2. Read the "Start here" block and the waiting-on-the-owner list in `docs/STATUS.md`.
3. Ask the owner the questions that block work. **Nothing goes to `main` without a yes.**

## The rules this project learned the hard way

**The design-note gate is unconditional** for phase work from a spec, or anything architectural.
The note is written and reviewed before any code.

**The auditor runs in a clean session and never inherits the builder's context.** Give it three
things only: the spec path, `git diff main...HEAD`, and the invariant list. Never the builder's
design note — it would adopt the builder's reasoning and inherit the same blind spot. Tell it to
find the concrete scenario where the change breaks the spec, not to "review the code": given a
target it finds defects, asked to review it writes praise. Tell it to work directly and not spawn
subagents — one audit fanned out, hit rate limits and produced nothing.

**The model quota is shared across all non-Gemini models**, not per model. Never spend it on
building; the builder runs on Gemini. The adversarial audit is the one job worth that quota.

**For every non-trivial rule, answer two questions in writing**: how does it behave in the
ordinary flow, and which earlier decision does it intersect. Five of the six findings in the M2b
audit were faithful implementations of rules that were exact and wrong — each right alone and
wrong together. This is a requirement on the design note, not advice.

**Whenever a grant names `anon` or `authenticated`, ask who holds that role here.** In this
product `authenticated` includes every signed-in shopper. M2c shipped a view exposing every
deposit — names, phone numbers, agreed prices — to any customer with an account, while the
underlying table's RLS was correct and irrelevant.

**Every audit finding that can be expressed mechanically becomes a check** in
`scripts/audit/check-invariants.mjs`. There are 21.

**A builder round is accepted against the diff, never against its notes.** Use the
`builder-round-accept` skill; it is the checklist.

**"It exists" is not "it works."** Every serious miss of the M4 rounds was something present and
plausible: SQL that parsed in the head, a schema with invented fields, a reader list built by
grepping one name while the value travelled under another. Follow the value, not the identifier.

**Keep builder rounds small and exact.** Three or four items, each with file, line, the real error
text and the expected change. A general must/must-not list did not stop a violation; a mechanical
check did.

**Read-only audits and mechanical git work can run as sub-agents in their own worktrees** while
the builder holds the phase branch. Check their top findings against the code before repeating
them.

**Frontend work consults `modern-web-guidance` first** — `search`, then `retrieve`. Required by
`AGENTS.md`; detail in `artifacts/store/AGENTS.md`.

## What not to do

- Do not start anything on the roadmap's deferred list. Each has a stated condition for
  reopening; check it is met.
- Do not run a migration against anything but the test project. Never production.
- Do not treat the two unmoved business items as engineering problems: the 500 products' data and
  the design-partner agreement. Finishing another phase still leaves a finished, empty, unsold
  system. Say so once if it is relevant; do not build around it.
- Do not claim the integration tier passed locally. It needs credentials and a running API
  server; it runs in CI. State which tiers you actually ran.
