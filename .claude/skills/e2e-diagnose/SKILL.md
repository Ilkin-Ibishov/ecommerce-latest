---
name: e2e-diagnose
description: >-
  Use when a Playwright E2E test or a CI run fails and the reason is not obvious from the
  assertion text — a selector that does not match, a flaky-looking timeout, a page that looks
  right in the diff. Gets the accessibility tree at the moment of failure instead of guessing.
---

# Diagnosing an E2E failure

**Download the report. Do not read the diff and reason about it.**

```bash
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
gh run view <run-id> --log-failed | tail -60
gh run download <run-id> -n playwright-report
```

The report holds `error-context.md` per failure: **the full accessibility tree at the moment the
test failed.** That is what showed a page rendering perfectly in English when the assertion
expected Azerbaijani — something no amount of reading the diff would have revealed.

Prefer this to `--log-failed` for anything selector-shaped. `--log-failed` on one run was about
40 KB of ANSI-escaped log for six useful lines; the `ci-triage` subagent exists to keep that out
of your context.

## Reading it

1. Find the failing assertion's `file:line` in the log tail.
2. Open the matching `error-context.md` and look for the element the selector names. Present under
   a different accessible name means a locale or label problem, not timing — see the
   `locale-key-add` skill for the trap this project hit twice.
3. Absent entirely means a route, a guard or a fixture problem. Check what the tree does show.
4. Present and correct means timing. Only then is "flaky" the right word.

**A repeated test name does not mean a repeated cause.** Two unrelated bugs produced the same
failing test name in this repository, one locale and one timing.

## What is already known flaky

`counter-sale.spec.ts`, "completes counter sale with wedge scanner at desktop width", times out
occasionally and passes on retry. Confirm against the tree before adding to this list — calling a
real failure flaky costs a session.
