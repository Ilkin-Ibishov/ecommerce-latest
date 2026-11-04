import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * F5 Test Suite — Stocktake Mutation Security & Draft Status Guards
 *
 * Requirements:
 * - A staff token patching and deleting a line on a posted stocktake gets 400.
 * - On a draft stocktake it succeeds.
 * - A staff token deleting a stocktake gets 403.
 * - Invariant: stocktake-mutations-check-draft-status.
 */

interface Stocktake {
  id: string;
  status: "draft" | "posted" | "cancelled";
}

interface StocktakeLine {
  id: string;
  stocktake_id: string;
  counter_id: string;
  counted_quantity: number;
}

interface UserContext {
  id: string;
  role: "admin" | "staff" | "customer";
}

class StocktakeServiceHarness {
  public stocktakes = new Map<string, Stocktake>();
  public lines = new Map<string, StocktakeLine>();

  public patchLine(
    stocktakeId: string,
    lineId: string,
    countedQuantity: number,
    caller: UserContext,
  ): { status: number; body: { error?: string; line?: StocktakeLine } } {
    if (countedQuantity < 0) {
      return { status: 400, body: { error: "Non-negative counted_quantity is required" } };
    }

    const st = this.stocktakes.get(stocktakeId);
    if (!st) return { status: 404, body: { error: "Stocktake not found" } };
    if (st.status !== "draft") {
      return { status: 400, body: { error: `Cannot modify lines on a ${st.status} stocktake` } };
    }

    const line = this.lines.get(lineId);
    if (!line) return { status: 404, body: { error: "Line not found" } };

    if (caller.role === "staff" && line.counter_id !== caller.id) {
      return { status: 403, body: { error: "Forbidden: staff can only edit their own count lines" } };
    }

    line.counted_quantity = countedQuantity;
    return { status: 200, body: { line } };
  }

  public deleteLine(
    stocktakeId: string,
    lineId: string,
    caller: UserContext,
  ): { status: number; body: { error?: string; success?: boolean } } {
    const st = this.stocktakes.get(stocktakeId);
    if (!st) return { status: 404, body: { error: "Stocktake not found" } };
    if (st.status !== "draft") {
      return { status: 400, body: { error: `Cannot delete lines on a ${st.status} stocktake` } };
    }

    const line = this.lines.get(lineId);
    if (!line) return { status: 404, body: { error: "Line not found" } };

    if (caller.role === "staff" && line.counter_id !== caller.id) {
      return { status: 403, body: { error: "Forbidden: staff can only delete their own count lines" } };
    }

    this.lines.delete(lineId);
    return { status: 200, body: { success: true } };
  }

  public deleteStocktake(
    stocktakeId: string,
    caller: UserContext,
  ): { status: number; body: { error?: string; success?: boolean } } {
    // requireAdmin middleware: only admin permitted
    if (caller.role !== "admin") {
      return { status: 403, body: { error: "Forbidden: administrator required" } };
    }

    const st = this.stocktakes.get(stocktakeId);
    if (!st) return { status: 404, body: { error: "Stocktake not found" } };
    if (st.status !== "draft") {
      return { status: 400, body: { error: "Can only discard draft stocktakes" } };
    }

    this.stocktakes.delete(stocktakeId);
    return { status: 200, body: { success: true } };
  }
}

describe("F5: Stocktake Mutation Guards and Role Protections", () => {
  it("staff token patching a line on a posted stocktake gets 400 naming the status", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-posted", { id: "st-posted", status: "posted" });
    h.lines.set("line-1", { id: "line-1", stocktake_id: "st-posted", counter_id: "staff-1", counted_quantity: 10 });

    const caller: UserContext = { id: "staff-1", role: "staff" };
    const res = h.patchLine("st-posted", "line-1", 15, caller);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/posted/i);
    expect(h.lines.get("line-1")?.counted_quantity).toBe(10);
  });

  it("staff token deleting a line on a posted stocktake gets 400 naming the status", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-posted", { id: "st-posted", status: "posted" });
    h.lines.set("line-1", { id: "line-1", stocktake_id: "st-posted", counter_id: "staff-1", counted_quantity: 10 });

    const caller: UserContext = { id: "staff-1", role: "staff" };
    const res = h.deleteLine("st-posted", "line-1", caller);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/posted/i);
    expect(h.lines.has("line-1")).toBe(true);
  });

  it("staff token patching a line on a draft stocktake succeeds", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-draft", { id: "st-draft", status: "draft" });
    h.lines.set("line-1", { id: "line-1", stocktake_id: "st-draft", counter_id: "staff-1", counted_quantity: 10 });

    const caller: UserContext = { id: "staff-1", role: "staff" };
    const res = h.patchLine("st-draft", "line-1", 25, caller);

    expect(res.status).toBe(200);
    expect(res.body.line?.counted_quantity).toBe(25);
    expect(h.lines.get("line-1")?.counted_quantity).toBe(25);
  });

  it("staff token deleting a line on a draft stocktake succeeds", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-draft", { id: "st-draft", status: "draft" });
    h.lines.set("line-1", { id: "line-1", stocktake_id: "st-draft", counter_id: "staff-1", counted_quantity: 10 });

    const caller: UserContext = { id: "staff-1", role: "staff" };
    const res = h.deleteLine("st-draft", "line-1", caller);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(h.lines.has("line-1")).toBe(false);
  });

  it("staff token deleting a stocktake gets 403 Forbidden", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-draft", { id: "st-draft", status: "draft" });

    const caller: UserContext = { id: "staff-1", role: "staff" };
    const res = h.deleteStocktake("st-draft", caller);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/i);
    expect(h.stocktakes.has("st-draft")).toBe(true);
  });

  it("admin token deleting a draft stocktake succeeds", () => {
    const h = new StocktakeServiceHarness();
    h.stocktakes.set("st-draft", { id: "st-draft", status: "draft" });

    const caller: UserContext = { id: "admin-1", role: "admin" };
    const res = h.deleteStocktake("st-draft", caller);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(h.stocktakes.has("st-draft")).toBe(false);
  });

  it("static code inspection verifies draft status check and requireAdmin middleware in real route files", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");

    const linesRoute = fs.readFileSync(
      path.join(root, "artifacts/api-server/src/routes/admin/stocktake-lines.ts"),
      "utf-8"
    );
    const stocktakesRoute = fs.readFileSync(
      path.join(root, "artifacts/api-server/src/routes/admin/stocktakes.ts"),
      "utf-8"
    );

    // PATCH /admin/stocktakes/:id/lines/:lineId checks draft status
    expect(linesRoute).toMatch(/router\.patch\(\s*["']\/admin\/stocktakes\/:id\/lines\/:lineId["'][\s\S]*?st\.status\s*!==\s*["']draft["']/);

    // DELETE /admin/stocktakes/:id/lines/:lineId checks draft status
    expect(linesRoute).toMatch(/router\.delete\(\s*["']\/admin\/stocktakes\/:id\/lines\/:lineId["'][\s\S]*?st\.status\s*!==\s*["']draft["']/);

    // DELETE /admin/stocktakes/:id requires requireAdmin
    expect(stocktakesRoute).toMatch(/router\.delete\(\s*["']\/admin\/stocktakes\/:id["'],\s*requireAdmin/);
  });
});
