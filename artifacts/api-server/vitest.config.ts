import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-integration",
    root: import.meta.dirname,
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/serial/**"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These files wait on the network (Supabase, the local API), not the CPU, so CI runs more
    // of them at once than the default (CPUs - 1 = 3). Files are already shuffled and parallel.
    maxWorkers: process.env.CI ? 6 : undefined,
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
