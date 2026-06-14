import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    name: "store-unit",
    root: import.meta.dirname,
    // All vitest unit/property tests live under src/__tests__ (and co-located src/**/*.test.ts).
    // Playwright specs (tests/e2e/*.spec.ts, tests/components/*.spec.tsx) are not matched by this glob.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
