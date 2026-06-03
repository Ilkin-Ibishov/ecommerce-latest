import { defineConfig } from "@playwright/experimental-ct-react";
import path from "path";

export default defineConfig({
  testDir: "./tests/components",
  use: {
    ctViteConfig: {
      resolve: {
        alias: {
          "@": path.resolve(import.meta.dirname, "src"),
          "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
        },
      },
    },
  },
});
