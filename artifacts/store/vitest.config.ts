import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Use React's automatic JSX runtime so component source (.tsx) compiles without
  // an explicit `import React`. Required by DOM tests that render components in
  // jsdom (e.g. login-modal-profile-reroute.test.ts); inert for node-only tests
  // that never render JSX.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
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
