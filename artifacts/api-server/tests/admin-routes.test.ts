import { describe, it, expect } from "vitest";
import type { IRouter } from "express";
import adminRouter from "../src/routes/admin/index";

/**
 * Admin route-registration parity test (Task 10.2 / R9.4, design §13).
 *
 * The admin API was split from a single `routes/admin.ts` into per-domain
 * modules under `routes/admin/` aggregated by `routes/admin/index.ts`
 * (task 10.1). This test guards the split by introspecting the aggregated
 * router's layer stack — it does NOT start a server or touch the database.
 *
 * It asserts two things:
 *   1. The exact SET of admin routes (method + path) is registered — nothing
 *      added, nothing dropped by the split.
 *   2. Ordering-sensitive routes keep their relative registration order, so a
 *      more specific literal route is never shadowed by a `:id` param route
 *      that should follow it.
 */

type RegisteredRoute = { method: string; path: string };

/**
 * Recursively flatten an Express router's layer stack into an ordered list of
 * { method, path } in registration order. Mounted sub-routers (added via
 * `router.use(subRouter)`) are walked depth-first; because every admin route
 * is declared with an absolute path (e.g. "/admin/products/:id"), the path on
 * each route layer is already the full path.
 */
function flattenRoutes(router: IRouter, acc: RegisteredRoute[] = []): RegisteredRoute[] {
  // `stack` is an internal Express field not present on the public type.
  const stack: any[] = (router as any).stack ?? [];
  for (const layer of stack) {
    if (layer.route) {
      const path: string = layer.route.path;
      const methods: Record<string, boolean> = layer.route.methods ?? {};
      for (const method of Object.keys(methods)) {
        if (methods[method] && method !== "_all") {
          acc.push({ method: method.toUpperCase(), path });
        }
      }
    } else if (layer.handle && (layer.handle as any).stack) {
      flattenRoutes(layer.handle as IRouter, acc);
    }
  }
  return acc;
}

const routes = flattenRoutes(adminRouter);
const keys = routes.map((r) => `${r.method} ${r.path}`);

/** Index of the first route matching method + path (or -1). */
function indexOf(method: string, path: string): number {
  return keys.indexOf(`${method} ${path}`);
}

// The complete inventory of admin endpoints the split must preserve (R9.4).
const EXPECTED_ROUTES = [
  // usage.ts
  "GET /admin/usage",
  // products.ts
  "POST /admin/upload",
  "POST /admin/products",
  "PATCH /admin/products/bulk-flag",
  "DELETE /admin/products/bulk",
  "PATCH /admin/products/:id",
  "DELETE /admin/products/:id",
  "PATCH /admin/products/:id/stock",
  "POST /admin/products/:id/duplicate",
  // banners.ts
  "GET /admin/banners",
  "POST /admin/banners",
  "PATCH /admin/banners/:id",
  "DELETE /admin/banners/:id",
  // brands-management.ts
  "GET /admin/brands",
  "POST /admin/brands",
  "PATCH /admin/brands/reorder",
  "PATCH /admin/brands/:id",
  "DELETE /admin/brands/:id",
  // orders.ts
  "GET /admin/orders/export",
  "PATCH /admin/orders/:id/status",
  "PATCH /admin/orders/:id/notes",
  "GET /admin/orders/:id/notifications",
  // categories.ts
  "POST /admin/categories",
  "PATCH /admin/categories/:id",
  "DELETE /admin/categories/:id",
  // coupons.ts
  "POST /admin/coupons",
  "PATCH /admin/coupons/:id",
  "DELETE /admin/coupons/:id",
  // whatsapp.ts
  "GET /admin/whatsapp/status",
  "POST /admin/whatsapp/test",
  "POST /admin/notifications/:id/retry",
  // users.ts
  "GET /admin/users",
  "PATCH /admin/users/:id/role",
  // settings.ts
  "GET /admin/settings",
  "PATCH /admin/settings",
  // comments.ts
  "PATCH /admin/comments/:id",
  "DELETE /admin/comments/:id",
] as const;

describe("admin router registration parity (R9.4, design §13)", () => {
  it("registers every expected admin route exactly once (method + path set parity)", () => {
    // Set parity: same membership, no missing routes, no extras, no dupes.
    expect([...keys].sort()).toEqual([...EXPECTED_ROUTES].sort());
    // No duplicate (method, path) registrations leaked in from the split.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("preserves the full registration order of the aggregated admin router", () => {
    // Locks the complete relative order as a regression guard. This inherently
    // covers every ordering-sensitive case asserted individually below.
    expect(keys).toEqual([...EXPECTED_ROUTES]);
  });

  it("keeps /admin/orders/export ahead of every /admin/orders/:id route", () => {
    const exportIdx = indexOf("GET", "/admin/orders/export");
    expect(exportIdx).toBeGreaterThanOrEqual(0);

    const orderIdRoutes = keys
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => k.includes(" /admin/orders/:id"));
    expect(orderIdRoutes.length).toBeGreaterThan(0);
    for (const { k, i } of orderIdRoutes) {
      expect(exportIdx, `export must precede ${k}`).toBeLessThan(i);
    }
  });

  it("keeps the literal bulk product routes ahead of ALL /admin/products/:id routes (shadowing fix)", () => {
    // The literal "bulk-flag" / "bulk" paths MUST be registered before every
    // `/admin/products/:id*` param route, otherwise Express's `:id` matches
    // "bulk-flag"/"bulk" as an id and shadows the bulk handlers (the pre-existing
    // bug fixed in the architecture-refactoring follow-up). This asserts the
    // corrected order: bulk routes precede the two-segment PATCH/DELETE /:id
    // routes AND the multi-segment /:id/stock, /:id/duplicate routes.
    const bulkFlag = indexOf("PATCH", "/admin/products/bulk-flag");
    const bulkDelete = indexOf("DELETE", "/admin/products/bulk");

    const idRoutes = keys
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => /\s\/admin\/products\/:id/.test(k));

    expect(bulkFlag).toBeGreaterThanOrEqual(0);
    expect(bulkDelete).toBeGreaterThanOrEqual(0);
    expect(idRoutes.length).toBeGreaterThan(0);

    for (const { k, i } of idRoutes) {
      expect(bulkFlag, `bulk-flag must precede ${k}`).toBeLessThan(i);
      expect(bulkDelete, `bulk must precede ${k}`).toBeLessThan(i);
    }
  });
});
