import { defineConfig } from "vitest/config";

/**
 * Dedicated config for the env-validation property test.
 * Does NOT include setup.ts (which validates env vars and would throw
 * before the test can exercise the validation logic in isolation).
 */
export default defineConfig({
  test: {
    name: "env-validation",
    root: import.meta.dirname,
    include: ["tests/env-validation.test.ts"],
    environment: "node",
  },
});
