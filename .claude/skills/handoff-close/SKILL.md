---
name: handoff-close
description: >-
  Use when ending a session on this repository, writing a handoff, or updating docs/STATUS.md —
  the close-out that keeps STATUS.md near 10 KB and puts the handoff where the next session will
  find it. Also use when asked to wrap up, write the status, or hand off to a new session.
---

# Closing a session

`docs/STATUS.md` is **current state only**, near 10 KB (AGENTS.md, "Handoff"). This is the
procedure.

## The close-out, in one commit

1. **Write the new "Start here" block** in `docs/STATUS.md`: where `main` is, the CI runs that
   prove it, what is in flight (or that nothing is), and what to do first.
2. **Move the block it replaces** to `docs/archive/status/<date>-<slot>.md`
   (`2026-11-17-evening.md`), verbatim, under a one-line "archived, superseded" header.
3. **Add its row to the History table** in `docs/STATUS.md`.
4. **Keep current** in STATUS.md: the open-branch table, the waiting-on-the-owner list, the open
   defects, the business blockers. Update them in place; never append a second copy.
5. **Durable process goes to `docs/agent-workflow.md`**, never into STATUS.md. A lesson worth
   keeping after this session is archived is process, not status.
6. **Commit it to `main`.** A handoff that is not on `main` is a handoff that gets lost: one sat
   unmerged on its own branch and the next session nearly started from a session-old STATUS.md.

## What the next session must be able to do without asking

- Confirm `main` is green from the run ids you wrote down.
- See every open branch with its tip and why it is not merged.
- See every question that blocks work, in the order they block it.
- Know that nothing is running — or exactly what is, and where its log is.

What must be in a file rather than in chat is AGENTS.md's "Audit interface"; it applies here too.
