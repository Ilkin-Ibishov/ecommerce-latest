---
trigger: glob
globs: **/*.test.ts,**/*.spec.ts,artifacts/api-server/tests/**
description: Testing rules and standards for this repository
---

# Testing rules

## What a test must do
- Fail for one reason. If a test can fail for three unrelated causes, split it.
- Assert behaviour, not implementation. A test that breaks on a rename but not on a wrong result
  is worse than no test.
- Use the existing helpers in `artifacts/api-server/tests/helpers/` rather than writing a parallel
  model of the same behaviour. `stock-model.ts` already simulates decrement semantics — extend it.

## What is not allowed
- Deleting or skipping an existing test to make a suite pass. If it breaks, either the code is
  wrong or the test encoded an assumption that changed — say which, in the design note.
- Loosening an assertion to make it pass. Narrow it or fix the cause.
- Tests that pass because the thing under test was mocked away. If every dependency is a stub,
  the test asserts that stubs work.

## Required coverage for inventory work
- A property or concurrency test asserting the ledger sum equals on-hand quantity after
  interleaved operations, including failures and rollbacks.
- A test that a quantity cannot be changed through any route without producing a movement row.
- A test per RLS policy added: a user of tenant A cannot read or write tenant B's rows.

## Before declaring done
`pnpm run typecheck`, `pnpm test` and `pnpm run audit:invariants` must all pass.
Report the actual output, not a summary of what you expect it to be.
