---
inclusion: always
---

# Agent Behavioral Rules

These rules correct specific failure patterns observed during past work on this project.

## 1. Scope-Proportional Process

Before entering a full spec workflow (bugfix.md → design.md → tasks.md), assess the change:

- **Small fix** (≤3 files, clear diagnosis, no design ambiguity): Suggest "Quick Plan" or direct implementation. Don't run full spec unless user insists.
- **Medium fix** (4–10 files, some design decisions needed): Full spec is appropriate.
- **Large feature** (new system, multiple modules): Full spec mandatory.

Indicators of a small fix: the fix is already described in the user's message, the affected files are known, and the change is a prop addition / element swap / config tweak.

## 2. Git Safety Defaults

- **Always push to a feature branch** unless the user says "push directly to main" twice (explicit double-confirmation).
- Branch naming: `fix/`, `feat/`, `chore/` prefix + kebab-case description.
- After pushing, suggest creating a PR if the repo has CI configured.
- This project auto-deploys from `main` to Vercel — treat main pushes as production deployments.

## 3. Test Quality Over Test Quantity

- **Never regex-test source code** as a proxy for behavior. If you need to verify a component renders `<h2>`, render it in jsdom and query the DOM.
- Check vitest config for `environment: 'jsdom'` or `'happy-dom'` before assuming tests can't render components.
- If the test environment is truly `node`-only, write behavioral tests that import and call functions, not regex pattern matches on `.tsx` files.
- Prefer fewer meaningful DOM-based tests over many source-pattern tests.

## 4. Read Once, Remember

- After reading a file, don't re-read it unless you expect it changed (e.g., a subagent just modified it).
- For subagent context, pass line ranges (`startLine`/`endLine`) when only a section is relevant — not the entire file.
- Use `grep_search` to locate insertion points before reading full files.

## 5. Parallel Task File Conflicts

When dispatching parallel subagents that write to the **same file**:
- Serialize them (dispatch sequentially), OR
- Explicitly instruct the second subagent: "File already exists — append a new describe block, don't overwrite."

Never dispatch two create-file operations to the same path in parallel.

## 6. Verification Honesty

- If a task says "run Lighthouse audit" and you only ran vitest, say so: "Typecheck and unit tests pass. Lighthouse audit was not run — you can verify with DevTools."
- Don't claim broader verification than what was actually performed.
- When subagents report success, spot-check the specific claim against what was actually executed.

## 7. Assertive Safety Communication

When a user requests something risky (push to main on auto-deploy repo, delete files, modify production config):
- State the risk in one sentence.
- Offer the safer alternative as the default action.
- Only proceed with the risky action if the user explicitly confirms.

Don't use soft language like "I'd recommend..." — state it directly: "This deploys to production immediately. I'll push to a branch instead unless you confirm."
