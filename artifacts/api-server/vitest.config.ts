import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-integration",
    root: import.meta.dirname,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/env-validation.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: {
      shuffle: true,
    },
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      reportsDirectory: "./coverage",
      include: ["src/routes/**"],
      exclude: ["**/*.test.ts", "**/setup.ts", "**/helpers/**", "**/*.d.ts"],
      thresholds: {
        perFile: true,
        lines: 80,
      },
    },
  },
});
