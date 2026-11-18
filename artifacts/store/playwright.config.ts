import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration.
 *
 * Runs against either:
 * - Local dev server (http://localhost:3000) during development
 * - Deployed Vercel URL (set BASE_URL env var) for post-deploy smoke tests
 *
 * Usage:
 *   pnpm --filter @workspace/store exec playwright test
 *   BASE_URL=https://ecommerce-latest-api-server.vercel.app pnpm --filter @workspace/store exec playwright test
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Public-repo runners have 4 vCPUs. Was 1, when every admin test signed in by OTP and
  // parallel sign-ins timed out; the admin session is now created once by the setup project.
  workers: process.env.CI ? 3 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Signs in as admin once and saves the session (tests/helpers/admin-auth.ts).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
