import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "artifacts/api-server/vitest.config.ts",
  "artifacts/api-server/vitest.config.env-test.ts",
  "artifacts/store/vitest.config.ts",
]);
