import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    name: "store-unit",
    root: import.meta.dirname,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [
      "tests/e2e/**",
      "tests/components/**",
      // WIP: empty test file (no suites yet) from product-image-management — re-enable once it has tests
      "tests/image-proxy.property.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
