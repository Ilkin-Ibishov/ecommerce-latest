import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    name: "store-unit",
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
