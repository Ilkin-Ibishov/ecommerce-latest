---
inclusion: manual
---

# Token Efficiency Guide

Reference this when context is filling up or sessions are getting slow.

---

## Root Causes of High Token Usage

| Cause | Impact | Fix |
|-------|--------|-----|
| `inclusion: always` on large steering files | Loads every turn | Change to `fileMatch` or `manual` |
| Reading full files when only a section is needed | 300–800 tokens per over-read | Use `start_line`/`end_line` or `grep_search` first |
| Pasting full file contents in user messages | Fills context instantly | Use `#File` reference instead of paste |
| Large MCP tool outputs (e.g. all 17 deployments) | 2,000+ tokens per call | Use targeted calls (`get_deployment` not `list_deployments`) |
| Repeated reads of the same file across turns | Cumulative waste | Read once; rely on memory for the rest of the task |
| Long conversation chains on one topic | Context compounds | Start a new Kiro session for unrelated tasks |

---

## Steering File Inclusion Strategy

```
inclusion: always    → Only for core facts needed on EVERY turn (<500 tokens total)
inclusion: fileMatch → For patterns only relevant when editing specific files
inclusion: manual    → For reference docs, playbooks, detailed specs
```

**Current configuration:**
- `project-overview.md` → `always` (lean ~350 token summary only)
- `coding-standards.md` → `manual` (use `#coding-standards` when needed)
- `api-development.md` → `fileMatch: **/api-server/**`
- `express5-patterns.md` → `fileMatch: **/api-server/src/**`
- `frontend-development.md` → `fileMatch: **/store/**`
- Everything else → `manual`

---

## Kiro Best Practices for Large Codebases

### Use `grep_search` before reading files
```
grep_search("handleAddToCart") → find exact line → read_file(start_line, end_line)
```
Much cheaper than reading the whole file.

### Use `#File` context references in chat
Instead of pasting file contents into a message, type `#File` and select the file. Kiro reads it efficiently without adding the content to visible history.

### Use Spec sessions for multi-file features
Kiro's **Spec mode** (structured requirements → design → tasks) scopes context to one feature at a time and prevents unrelated context accumulation.

### Use `context-gatherer` sub-agent for exploration
For codebase investigation, use the `context-gatherer` sub-agent rather than manually reading many files. It runs in isolated context and returns a focused summary.

### Start fresh sessions for unrelated tasks
A session about WhatsApp templates shouldn't share context with a session about dashboard charts. Each new task = new session.

### Avoid redundant verification reads
After using `str_replace` or `getDiagnostics`, trust the tool output. Don't re-read the file just to confirm the change was applied.

---

## This Project's Large Files (read sparingly)

| File | Size | Strategy |
|------|------|----------|
| `artifacts/store/src/lib/i18n/messages.ts` | ~900 lines | Use `grep_search` for specific keys |
| `artifacts/api-server/src/routes/admin.ts` | ~650+ lines | Use `grep_search` to find insertion points |
| `artifacts/store/src/pages/admin/DashboardPage.tsx` | ~500 lines | Use `grep_search` for section names |
| `artifacts/store/src/App.tsx` | ~120 lines | Safe to read fully |

---

## Context Budget Rule of Thumb

- < 40% full → Work normally
- 40–70% full → Avoid full-file reads; use `grep_search` + targeted ranges
- 70–90% full → Finish current task, commit, start new session
- > 90% full → Kiro will auto-compact; results may be less coherent
