# Design note — agent context modularization

Written 2026-11-17. Research task, no implementation. Every number below was measured in this
worktree at `fix/main-live-defects` (`d242549`), with the commands shown.

## Summary of the finding

The `.agents/` tree is **not** the problem. It is 28 KB across 11 files, every file carries
trigger frontmatter, and it is the best-organised context in the repository.

Two different problems cost the tokens:

1. **`docs/STATUS.md` is 80 KB and is read in full at every session start.** 45% of it is
   explicitly labelled superseded history. This is ~85% of the avoidable waste.
2. **`.agents/` is inert under Claude Code.** There is no `.claude/` directory in this repository
   (`git ls-files | grep '^\.claude/'` returns 0). `.agents/rules`, `.agents/skills` and
   `.agents/agents` are the Antigravity/Cursor convention, which the AGY builder reads and Claude
   Code does not. Four well-written skills and two well-written sub-agents never fire in a Claude
   session.

## What a session actually loads before it does any work

The read-first list in `prompts/session-start-orchestrator.md`:

```bash
wc -c docs/STATUS.md AGENTS.md prompts/session-start-orchestrator.md docs/tasks/warehouse-roadmap.md docs/tasks/warehouse-m4-stock-signals.md docs/tasks/warehouse-m3-section-16-decisions.md
```

| File | Bytes | ≈ tokens | Loaded |
|---|---|---|---|
| `docs/STATUS.md` | 80,129 | ~22,000 | every session, in full |
| `prompts/session-start-orchestrator.md` | 8,321 | ~2,300 | pasted by hand every session |
| `docs/tasks/warehouse-m4-stock-signals.md` | 19,746 | ~5,500 | every session per the read-first list |
| `docs/tasks/warehouse-m3-section-16-decisions.md` | 15,188 | ~4,200 | every session per the read-first list |
| `AGENTS.md` | 5,098 | ~1,400 | always in context (correct) |
| `docs/tasks/warehouse-roadmap.md` | 5,293 | ~1,500 | every session |
| **Total** | **133,775** | **~37,000** | **before the first line of work** |

### Inside STATUS.md

```bash
grep -n "^## " docs/STATUS.md
```

| Lines | Section | Status |
|---|---|---|
| 1–141 | Start here (2026-11-16 evening) | current |
| 142–268 | Previously — 2026-11-16 afternoon | **superseded** |
| 269–376 | Previously — 2026-11-16 morning | **superseded** |
| 377–494 | Previously — 2026-11-15 | **superseded** |
| 495–597 | Previously — 2026-11-13 | **superseded** |
| 598–1000+ | Where to start / State / Next / Open / How work runs here | partly stale, overlaps "Start here" |

**456 lines — 45% of the file — carry a heading that tells the reader to ignore them.** Each
session pays roughly 10,000 tokens to read text whose own heading says it is superseded. The file
is append-only by habit: every session prepends a new "Start here" and demotes the last one.

### The rest of the corpus, unindexed

| Directory | Bytes | Files | Index |
|---|---|---|---|
| `docs/audits` | 642,171 | 50 | none |
| `docs/tasks` | 300,457 | 39 | none |
| `prompts` | 262,430 | 44 | none |
| `docs/design-notes` | 249,668 | 7 | none |
| `.kiro/specs` | ~500,000 | many | none |
| `.agents` | 28,200 | 11 | AGENTS.md names it |

1.2 MB in `docs/` with no index anywhere except `docs/knowledgebase/README.md` and
`docs/audits/wave-business-audit/README.md`. A session asking what the M4 audit found has to read
`docs/audits/m4-implementation-notes.md` (62 KB) or `m4-architect-audit.md` (35 KB) whole, because
nothing tells it which one holds the answer.

## Problem 2, in detail — why `.agents/` does not load

`.agents/rules/*.md` carry correct frontmatter:

| File | Trigger | Claude Code equivalent |
|---|---|---|
| `express5-api.md` | `glob: artifacts/api-server/**/*` | nested `AGENTS.md` in that directory |
| `frontend.md` | `glob: artifacts/store/**/*` | nested `AGENTS.md` in that directory |
| `migrations.md` | `glob: supabase/**/*.sql` | nested `AGENTS.md` — **missing** |
| `testing.md` | `glob: **/*.test.ts,**/*.spec.ts,...` | globs span directories, so it must be a skill |
| `inventory.md` | `model_decision` | this *is* a skill, by definition |

`artifacts/store/AGENTS.md` and `artifacts/api-server/AGENTS.md` already exist (1,095 and 1,074
bytes) and are the right pattern — scope-loaded, cheap, native. They are the proof the pattern
works here. They are also only 2 of the roughly 6 scopes that need one: nothing covers `supabase/`,
`lib/`, `scripts/` or `docs/tasks/`.

`.agents/skills/` holds four skills and `.agents/agents/` two sub-agents, all with proper `name`
and `description` frontmatter. Claude Code looks for these in `.claude/skills/` and
`.claude/agents/`. They are dead code in a Claude session today.

## Proposal

Ordered by tokens saved per unit of work. Each item is independent.

### A. Split STATUS.md — the one change that matters

Keep `docs/STATUS.md` as **current state only**: the "Start here" block, the open-branch table,
the waiting-on-owner list, and the open-defect list. Target 10 KB.

Move each superseded section verbatim to `docs/status/archive/<date>-<slot>.md`
(`2026-11-16-afternoon.md`, `2026-11-16-morning.md`, `2026-11-15.md`, `2026-11-13.md`) and leave
one line per archive file in STATUS.md under a `## History` heading. Nothing is lost; nothing
superseded is read.

Then make the close-out rule explicit in AGENTS.md: **a new handoff replaces the "Start here"
block and the old one moves to the archive in the same commit.** Without that rule the file grows
back within four sessions. This is the actual root cause — the file is append-only because no rule
says to prune it.

The "How work runs here" section (lines 954+) is durable, not status. It belongs in AGENTS.md or
its own `docs/agent-workflow.md`, not in a file that is rewritten every session.

Saving: roughly 19,000 tokens per session start.

### B. Make `.agents/` load — move it, do not mirror it

Mirroring means two copies and a drift bug in a month. Move to the native locations and point the
builder at them, since `run-agent.cmd` already instructs the builder to follow AGENTS.md:

```
.agents/skills/*/SKILL.md     ->  .claude/skills/*/SKILL.md
.agents/agents/*.md           ->  .claude/agents/*.md
.agents/rules/migrations.md   ->  supabase/AGENTS.md
.agents/rules/frontend.md     ->  merge into artifacts/store/AGENTS.md
.agents/rules/express5-api.md ->  merge into artifacts/api-server/AGENTS.md
.agents/rules/testing.md      ->  .claude/skills/testing-tiers/SKILL.md     (globs span dirs)
.agents/rules/inventory.md    ->  .claude/skills/inventory-domain/SKILL.md  (already model_decision)
```

`.claude/` must then be committed. `.gitignore` does not mention `.claude` at all today — it only
scopes `.agents/`:

```
63:.agents/*
64:!.agents/rules/
65:!.agents/agents/
66:!.agents/skills/
```

So the move commits cleanly, but it exposes a second problem: **this project puts its worktrees in
`.claude/worktrees/`** (this note was written in one), and nothing ignores them. Committing
`.claude/skills/` without first adding `.claude/worktrees/` to `.gitignore` invites a session to
commit an entire nested checkout. Add the ignore line in the same commit, mirroring the `.agents/`
pattern:

```
.claude/*
!.claude/skills/
!.claude/agents/
```

Saving: not a token saving. It is the difference between the rules applying and not applying. The
`reservations` locale key shipped missing through all three green merges while
`.agents/rules/frontend.md` rule 1 ("new keys must be added across az.ts, ru.ts and en.ts") sat on
disk, unread.

### C. Skills worth creating

Each one is prose that is currently either pasted by hand every session or buried inside an 8 KB
prompt. A skill is loaded when it is relevant and costs nothing when it is not.

| Skill | Replaces | Why |
|---|---|---|
| `session-start` | `prompts/session-start-orchestrator.md`, pasted manually | 8 KB pasted into every session. As a skill it loads on demand and the role section stops being re-pasted |
| `builder-round-accept` | the "a builder round is accepted against the diff" checklist inside that prompt | A mechanical checklist run once per round: count removed `it(` lines, no new `as any` / `@ts-ignore` / `.skip(`, a `pg_temp` rollback test for every new function, the three local tiers. Currently prose in the middle of a prose file |
| `locale-key-add` | nothing | Adding a key across az/en/ru **and** moving the E2E assertion to the locale the spec actually runs in. This project got it wrong twice: the stale-locale trap (six broken assertions, CI run 43852791362) and the `reservations` key fixed in `d242549` |
| `e2e-diagnose` | a line in STATUS.md's operational notes | `gh run download <id> -n playwright-report`, then read `error-context.md` for the accessibility tree at the moment of failure. STATUS.md calls it the fastest way to diagnose an E2E failure; it is one line of institutional memory buried at line ~130 of an 80 KB file |
| `testing-tiers` | `.agents/rules/testing.md` (6.2 KB, the largest rule file) | Which tier runs where, and the rule against claiming the integration tier passed locally |
| `inventory-domain` | `.agents/rules/inventory.md` | Already `trigger: model_decision`, which is what a skill is |
| `handoff-close` | the habit that grew STATUS.md to 80 KB | Writes the new Start-here block, moves the old one to the archive, commits to `main`. Encodes item A's rule so it cannot be forgotten |

Four of these already exist as text. Three are new. The work is mostly moving prose into a file
with a `description:` line, not writing new prose.

### D. Sub-agents worth creating

A sub-agent's value here is **keeping bulk output out of the orchestrator's context**, not
parallelism. Ranked by bytes kept out:

| Sub-agent | Returns | Keeps out of context |
|---|---|---|
| `ci-triage` | Given a run id: the failing assertion, the `file:line`, and the accessibility tree at failure | The whole `--log-failed` dump. The call I ran for run 44121162226 this session was about 40 KB of ANSI-escaped log for 6 useful lines. **Highest-value one** |
| `doc-finder` | Given a question: the 2–3 relevant paths from `docs/`, `prompts/` and `.kiro/`, with a 5-line summary of each | Reading 62 KB audit files whole to find one finding. 1.2 MB corpus, no index |
| `schema-verifier` | Given a column, table or enum name: whether it exists in `supabase/migrations/*.sql` and `supabase/schema.sql`, and in which file | Reading migrations. Directly serves AGENTS.md's "never invent a name" rule, and the `orders.subtotal_azn` question that has blocked `database.types.ts` for three sessions |
| `architect`, `auditor` | already written, in `.agents/agents/` | — move them per item B |

Both existing sub-agents are good and should not be rewritten — they only need to live in
`.claude/agents/`.

### E. Indexes, to stop blind globbing

`docs/audits/INDEX.md`, `docs/tasks/INDEX.md`, `prompts/INDEX.md`, `docs/design-notes/INDEX.md`:
one line per file — path, phase, date, verdict or one-line subject. About 50 lines each against
642 KB, 300 KB, 262 KB and 250 KB respectively. Cheap to write once; the `doc-finder` sub-agent
reads the index instead of globbing.

These go stale. The honest mitigation is to generate them: a `scripts/docs/build-index.mjs` that
reads each file's first heading and writes the index, run in the same CI job as the invariants so
a stale index fails the build. Hand-maintained indexes in a repository that merges three branches
a day will be wrong by Friday.

### F. One invariant, not a sub-agent

AGENTS.md's own rule: every audit finding that can be expressed mechanically becomes a check.
`pnpm run audit:invariants` now prints 20 `ok` lines.

**Add the next check: every `t("...")` key and every `labelKey` string in `artifacts/store/src`
exists in all three of `az.ts`, `en.ts`, `ru.ts`.** The `reservations` key fixed this session
shipped missing from all three dictionaries through three green CI runs.
`admin-i18n.property.test.ts` does not cover this — it tests locale *fallback*
(`getStoredLocale` returning `en` for invalid input), not key completeness. This is cheaper and
more reliable than any sub-agent or skill, and it is the project's stated convention for exactly
this kind of finding.

## Projected result

| | Bytes per session start | ≈ tokens |
|---|---|---|
| Today | 133,775 | ~37,000 |
| After A alone | ~63,600 | ~17,500 |
| After A + C (`session-start` skill, specs read on demand) | ~20,400 | ~5,600 |

Roughly 85% reduction, almost all of it from item A.

## Order of work

1. **A** (split STATUS.md, plus the pruning rule in AGENTS.md). Biggest win, touches no code,
   cannot break a build.
2. **F** (the i18n invariant). One check, catches a class of defect that has already shipped twice.
3. **B** (move `.agents/` to `.claude/`, add `supabase/AGENTS.md`). Check `.gitignore` first.
4. **C** (skills), largest first: `session-start`, `handoff-close`, `builder-round-accept`.
5. **D** (`ci-triage` first — it pays for itself on the next red CI run).
6. **E** (indexes) only with the generator from the start.

Items 1 and 2 are worth doing whatever is decided about the rest. Item 3 changes how both agents
read the repository and should be one commit, reviewed.

## Blocked / Assumptions / Not verified

- **Not verified:** that Claude Code ignores `.agents/rules/` frontmatter triggers. This rests on
  `.claude/` being the documented location for skills and sub-agents, on `.agents/` being the
  Antigravity/Cursor convention, and on the observed fact that `frontend.md` rule 1 did not prevent
  the missing `reservations` key. I did not run a controlled test.
- **Verified after the first draft:** `.gitignore` does not mention `.claude` (only `.agents/*`
  with three negations, lines 63–66). Item B's note was corrected accordingly, and it surfaced the
  unignored `.claude/worktrees/` risk recorded there.
- **Assumed:** that the AGY builder reads `.agents/` today. `run-agent.cmd` passes only "Follow
  AGENTS.md" and no `.agents/` path; the builder's own discovery of that tree was not confirmed. If
  it does not read it either, then those 11 files load for nobody and item B is more urgent, not
  less.
- **Assumed:** the token figures use about 3.6 bytes per token for English markdown. They are
  relative measures, not billing numbers.
- **Not measured:** the `.kiro/specs/` tree (about 500 KB). Nothing in AGENTS.md or the
  orchestrator prompt references it, so it may be dead weight from an earlier tool. Worth one
  question to the owner before anyone indexes it.
- **Tests:** none deleted, renamed, moved or weakened. This note adds no code.
- **Commands run:** `find` and `wc -c` for every size table above; `grep -n "^## " docs/STATUS.md`
  for the section spans; `git ls-files | grep '^\.claude/'` returned 0;
  `pnpm run audit:invariants` printed 20 `ok` lines, all passed.
