---
name: builder-round-accept
description: >-
  Use before declaring a builder round, an agent run or a fix branch done — the mechanical
  acceptance checklist run against the diff, never against the agent's own notes. Also use when
  reviewing a branch another agent produced, or when asked whether a round can be merged.
---

# Accepting a builder round

A round is accepted **against the diff, never against its notes**. In M4 the notes said one test
was deleted; the diff showed four, one of them the only test of the staff cost boundary.

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

## The checklist

Every item, every round. An item you skip is the one that bites.

1. **The changed files are the ones the prompt named.** Anything else is unrequested, however
   reasonable it looks.
2. **No test disappeared.** Count removed `it(` lines and account for each by name:
   ```bash
   git diff main...HEAD -- "*.test.ts" "*.spec.ts" | grep -c "^-.*\bit("
   git diff main...HEAD -- "*.test.ts" "*.spec.ts" | grep "^-.*\bit("
   ```
   AGENTS.md forbids deleting or skipping a test. A test that breaks gets its cause fixed or
   reported.
3. **No new escape hatch:**
   ```bash
   git diff main...HEAD | grep -nE "^\+.*(as any|@ts-ignore|@ts-expect-error|\.skip\(|\.only\()"
   ```
4. **Each replaced function diffs against its latest prior definition by only what was asked.** A
   rewritten function that happens to drop a guard reads as a clean replacement.
5. **Every new function and view is created on Postgres before you ask to apply it** — as
   `pg_temp` objects or temporary views inside a transaction you roll back, called once. Nothing
   persists, no migration is applied. Reading SQL is not enough: two M4 migrations read correctly
   and could not run.
6. **A validation schema is compared with what it validates**, not just seen to exist. Follow the
   value, not the identifier. "It exists" is not "it works."
7. **The three local tiers, run by you, on the merged tree:**
   ```bash
   pnpm run typecheck
   pnpm test:unit
   pnpm run audit:invariants
   ```
   The `api-integration` and `env-validation` projects need Supabase credentials and a running
   server; they run in CI. Never claim they passed locally — say which tiers you ran.
8. **No new file over 200 lines** without the design note saying why it must be.
9. **The notes file exists and is checked against the diff.** It must carry Blocked / Assumptions
   / Not verified, every test touched by name, and the real command output. An empty section
   claims there was nothing.

## Two things that look like completion and are not

- **The builder pushes at the end even when the prompt says "Do not push".** Check
  `origin/<branch>` before assuming your local view is current.
- **A stuck-looking builder is often not stuck.** One filled its log with ~65 identical waiting
  lines for 25 minutes, then finished cleanly with every commit. Read `.agent-runs/LAST-RUN.done`
  and the branch's commits before concluding anything; killing it discards finished work.
