import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-serial",
    root: import.meta.dirname,
    include: ["tests/serial/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
