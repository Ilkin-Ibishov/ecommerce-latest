---
name: test-runner
description: >-
  Use this skill to determine and execute the appropriate test tiers (offline unit tests, integration tests,
  property/conformance tests) according to environment requirements and repository rules.
---

# Test Runner Workflow

Testing in this repository is strictly tiered. Understanding the requirements of each tier prevents false claims and CI breakages.

## Test Tiers Overview

| Command | Tier | Requirements | Notes |
|---|---|---|---|
| `pnpm run test:unit` | Unit | None (Runs offline) | Tests `store-unit`, `env-validation`, and isolated helpers. |
| `pnpm run test:integration` | Integration | Running API server (port 5000) + Supabase DB | Tests live HTTP endpoints, database triggers, and RLS policies. |
| `pnpm test` | Full Suite | Full environment (Live DB + API server) | Runs all unit and integration projects via Vitest. |

> [!IMPORTANT]
> Never claim `pnpm test` passed unless you executed it with a running API server and live Supabase credentials. In local bare development without active credentials, run `pnpm run test:unit`.

## Running Offline Unit Tests

```bash
pnpm run test:unit
```

## Running Property & Conformance Tests

If you are working on stock, reservation, or ledger logic:
1. Concurrency tests must be genuinely parallel.
2. Property tests (`*.property.test.ts`) assert system invariants across generated sequences.
3. Conformance tests (`*.conformance.test.ts`) use `stock-model.ts` as an oracle to compare system outputs.

## Pre-Commit Verification Checklist

Before committing:
1. `pnpm run typecheck` must pass.
2. `pnpm run test:unit` must pass.
3. `pnpm run audit:invariants` must pass.
4. Report exactly which tiers passed and which tiers could not be run locally due to environment constraints.
