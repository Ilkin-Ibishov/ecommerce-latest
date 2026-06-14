# Store test helpers

Shared fixtures and test utilities for the store package, kept consistent with
the API server's [`tests/helpers/`](../../../api-server/tests/helpers/) structure.

## Test layout

- **Unit / property tests** (vitest) live under `artifacts/store/src/__tests__/`
  (and any co-located `src/**/*.test.ts`). The `store-unit` vitest project's
  `include` glob is `src/**/*.test.ts`.
- **Playwright component tests** live under `tests/components/*.spec.tsx`.
- **Playwright e2e tests** live under `tests/e2e/*.spec.ts`.
- **Shared helpers** live here (`tests/helpers/`).

Because unit/property specs live in `src/__tests__/`, import helpers with a
relative path:

```ts
import { makeProduct, makeProducts, SAMPLE_IMAGE_URL } from "../../tests/helpers/fixtures";
```

## Available helpers

- `fixtures.ts` — lightweight, dependency-free product fixtures
  (`makeProduct`, `makeProducts`) and a known-good `SAMPLE_IMAGE_URL`.

Keep helpers lightweight and free of heavy dependencies so they run cleanly in
the node-environment vitest project.
