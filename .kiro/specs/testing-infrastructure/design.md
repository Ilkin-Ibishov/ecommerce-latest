# Design Document: Testing Infrastructure

## Overview

This design establishes the testing infrastructure for the white-label e-commerce monorepo. It introduces a Vitest workspace at the repository root, integration tests for critical API paths (auth, cart, orders, coupons) against a real Supabase instance, and Playwright component tests for the React storefront. A single `pnpm test` command runs everything.

## Architecture

The testing infrastructure introduces a Vitest workspace at the monorepo root that orchestrates two distinct test projects:

1. **Integration Test Suite** — Vitest tests in `artifacts/api-server/tests/` that exercise API routes against a real Supabase instance.
2. **Component Test Suite** — Playwright component tests in `artifacts/store/tests/` that render React components in a real Chromium browser.

Both suites are discovered and executed via a single `pnpm test` command. The workspace configuration lives at the root as `vitest.workspace.ts` and delegates to per-project Vitest configs.

```
ecommerce-latest/
├── vitest.workspace.ts              # Root workspace config
├── package.json                     # "test" script added
├── artifacts/
│   ├── api-server/
│   │   ├── vitest.config.ts         # Integration test project config
│   │   └── tests/
│   │       ├── setup.ts             # Env validation + Supabase client setup
│   │       ├── helpers/
│   │       │   ├── auth.ts          # OTP auth helper (login/cleanup)
│   │       │   └── cleanup.ts       # Generic data cleanup utilities
│   │       ├── auth.test.ts
│   │       ├── cart.test.ts
│   │       ├── orders.test.ts
│   │       └── coupons.test.ts
│   └── store/
│       ├── playwright-ct.config.ts  # Playwright CT config
│       └── tests/
│           └── components/
│               └── *.spec.tsx       # Component tests
└── .env                             # Env vars (already exists)
```

## Components and Interfaces

### 1. Vitest Workspace Config (`vitest.workspace.ts`)

Defines the two test projects using Vitest's `defineWorkspace` API. Each project points to its own config file.

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "artifacts/api-server/vitest.config.ts",
  "artifacts/store/playwright-ct.config.ts",
]);
```

### 2. Integration Test Project Config (`artifacts/api-server/vitest.config.ts`)

Configures the API server integration tests with environment loading and setup file.

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-integration",
    root: import.meta.dirname,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: {
      shuffle: true,
    },
  },
});
```

### 3. Environment Validation (`artifacts/api-server/tests/setup.ts`)

A Vitest setup file that validates required environment variables before any test runs. Fails fast with a descriptive error identifying the missing variable.

```typescript
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from repo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    throw new Error(
      `Missing required environment variable: ${varName}. ` +
      `Ensure it is defined in .env or .env.test at the repository root.`
    );
  }
}

// Ensure dev mode for OTP dev store
process.env.NODE_ENV = "development";
```

### 4. Auth Test Helper (`artifacts/api-server/tests/helpers/auth.ts`)

Encapsulates the OTP login flow for integration tests. Uses the `/api/dev/mock-otp` endpoint to inject an OTP code, then verifies it to obtain a session token.

```typescript
interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  phone: string;
}

export async function loginTestUser(
  baseUrl: string,
  phone: string
): Promise<AuthSession> {
  // 1. Inject OTP via dev endpoint
  const mockRes = await fetch(`${baseUrl}/api/dev/mock-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const { code } = await mockRes.json();

  // 2. Verify OTP to get session
  const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  const session = await verifyRes.json();

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: session.userId ?? "",
    phone,
  };
}

export async function deleteTestUser(phone: string): Promise<void> {
  // Uses Supabase admin client to delete user by phone
  // Implementation uses SUPABASE_SERVICE_ROLE_KEY
}
```

### 5. Cleanup Utilities (`artifacts/api-server/tests/helpers/cleanup.ts`)

Provides `afterAll`/`afterEach` hooks that delete test-created data (users, orders, cart items, coupons) using the Supabase admin client.

```typescript
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function cleanupTestUser(userId: string): Promise<void> {
  // Delete in dependency order: order_items → orders → cart_items → coupon_usages → user
  await admin.from("order_items").delete().in(
    "order_id",
    (await admin.from("orders").select("id").eq("user_id", userId)).data?.map(o => o.id) ?? []
  );
  await admin.from("orders").delete().eq("user_id", userId);
  await admin.from("cart_items").delete().eq("user_id", userId);
  await admin.from("coupon_usages").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function cleanupTestCoupon(couponId: string): Promise<void> {
  await admin.from("coupon_usages").delete().eq("coupon_id", couponId);
  await admin.from("coupons").delete().eq("id", couponId);
}
```

### 6. Playwright Component Test Config (`artifacts/store/playwright-ct.config.ts`)

Configures Playwright's experimental component testing mode with Vite, resolving the same path aliases as the store's production config.

```typescript
import { defineConfig } from "@playwright/experimental-ct-react/test";
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
```

### Interfaces

#### Test Helper API

| Function | Parameters | Returns | Purpose |
|----------|-----------|---------|---------|
| `loginTestUser` | `baseUrl: string, phone: string` | `Promise<AuthSession>` | Authenticate via dev OTP flow |
| `deleteTestUser` | `phone: string` | `Promise<void>` | Remove auth user by phone |
| `cleanupTestUser` | `userId: string` | `Promise<void>` | Delete all data for a test user |
| `cleanupTestCoupon` | `couponId: string` | `Promise<void>` | Delete test coupon and usages |

#### AuthSession Interface

```typescript
interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  phone: string;
}
```

#### Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (admin operations) |
| `NODE_ENV` | Set to `development` for OTP dev store |

## Data Models

No new persistent data models are introduced. The testing infrastructure operates on existing database tables:

- `users` — test users created/deleted during auth tests
- `cart_items` — test cart entries created/deleted during cart tests
- `orders` / `order_items` — test orders created/deleted during order tests
- `coupons` / `coupon_usages` — test coupons inserted/deleted during coupon tests
- `products` — read-only; tests reference existing seed products

### Test Data Conventions

- Test phone numbers use the pattern `+994501234XXX` (where XXX varies per test)
- Test coupon codes use the prefix `TEST_` (e.g., `TEST_10PCT`, `TEST_EXPIRED`)
- All test data is cleaned up in `afterAll` hooks using the admin client

## Error Handling

### Environment Validation Errors

When a required environment variable is missing, the setup file throws immediately with a message like:

```
Missing required environment variable: SUPABASE_URL. Ensure it is defined in .env or .env.test at the repository root.
```

This causes Vitest to abort the entire integration suite before any test runs.

### Test Timeout Handling

Integration tests have a 30-second timeout per test. If a test exceeds this (e.g., Supabase is unreachable), Vitest reports a timeout failure with the test name.

### Cleanup Failure Handling

Cleanup utilities use best-effort deletion. If a cleanup operation fails (e.g., foreign key constraint), it logs a warning but does not fail the test suite. This prevents cascading failures from masking the actual test result.

## Testing Strategy

### Integration Tests (API Server)

Integration tests exercise the real API routes against a live Supabase instance. They are NOT mocked — the goal is to verify end-to-end behavior including database operations, auth flows, and RLS policies.

- **Auth tests**: Full OTP flow using dev mock endpoint (no SMS)
- **Cart tests**: Add, update quantity, remove — all authenticated
- **Orders tests**: Create order, retrieve order list — with stock deduction
- **Coupons tests**: Validate valid/invalid/expired codes

Each test file is independent and cleans up after itself. Tests run in shuffled order to catch hidden dependencies.

### Component Tests (Store Frontend)

Playwright component tests render individual React components in a real Chromium browser with Tailwind CSS applied. They verify interactive behavior (clicks, form inputs) and visual rendering without a full application server.

### Property-Based Tests

Only one property is suitable for PBT in this feature: environment variable validation. The remaining acceptance criteria are integration/smoke tests that exercise external infrastructure and don't benefit from randomized input generation.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Missing environment variable produces identifiable error

*For any* required environment variable removed from the set {SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY}, the validation function SHALL throw an error whose message contains the exact name of the missing variable.

**Validates: Requirements 3.3**
