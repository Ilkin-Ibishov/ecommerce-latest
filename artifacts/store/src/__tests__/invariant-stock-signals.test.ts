import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const checker = path.resolve(import.meta.dirname, "../../../../scripts/audit/check-invariants.mjs");

let tmpDir = "";
function createFixtureTree() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-sig-"));
  return tmpDir;
}

function runChecker(targetDir: string) {
  return spawnSync(process.execPath, [checker, "--root", targetDir], { encoding: "utf8" });
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("signals-have-one-derivation invariant", () => {
  it("fails when a duplicate signals file exists in lib/", () => {
    const dir = createFixtureTree();
    const libDir = path.join(dir, "artifacts", "api-server", "src", "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, "inventory-signals-helper.ts"), "export const x = 1;");

    const r = runChecker(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Duplicate signals derivation file in lib/ is forbidden");
  });

  it("fails when inventory-signals.ts has an empty catch block", () => {
    const dir = createFixtureTree();
    const routesDir = path.join(dir, "artifacts", "api-server", "src", "routes", "admin");
    fs.mkdirSync(routesDir, { recursive: true });
    fs.writeFileSync(
      path.join(routesDir, "inventory-signals.ts"),
      "try { doRpc(); } catch {}"
    );

    const r = runChecker(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Empty catch block forbidden in inventory-signals.ts");
  });

  it("passes when routes handle errors without empty catch and no lib duplicate exists", () => {
    const dir = createFixtureTree();
    const routesDir = path.join(dir, "artifacts", "api-server", "src", "routes", "admin");
    fs.mkdirSync(routesDir, { recursive: true });
    fs.writeFileSync(
      path.join(routesDir, "inventory-signals.ts"),
      "if (err) { res.status(500).json({ error: err.message }); }"
    );

    const r = runChecker(dir);
    expect(r.stdout).not.toContain("signals-have-one-derivation 1 total, 1 new");
  });
});

describe("no-undispatched-notification-type invariant", () => {
  it("fails when NotifType contains an unhandled type", () => {
    const dir = createFixtureTree();
    const notifDir = path.join(dir, "artifacts", "api-server", "src", "lib");
    fs.mkdirSync(notifDir, { recursive: true });
    fs.writeFileSync(
      path.join(notifDir, "notifications.ts"),
      `
      type NotifType = "order_confirmed" | "low_stock";
      export function queueNotification({ type }: { type: NotifType }) {
        if (type === "order_confirmed") {
          return true;
        }
      }
      `
    );

    const r = runChecker(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Notification type "low_stock" has no dispatch branch in queueNotification');
  });

  it("passes when all NotifType members have dispatch branches", () => {
    const dir = createFixtureTree();
    const notifDir = path.join(dir, "artifacts", "api-server", "src", "lib");
    fs.mkdirSync(notifDir, { recursive: true });
    fs.writeFileSync(
      path.join(notifDir, "notifications.ts"),
      `
      type NotifType = "order_confirmed" | "status_changed";
      export function queueNotification({ type }: { type: NotifType }) {
        if (type === "order_confirmed") {
          return true;
        } else if (type === "status_changed") {
          return true;
        }
      }
      `
    );

    const r = runChecker(dir);
    expect(r.stdout).not.toContain("no-undispatched-notification-type 1 total, 1 new");
  });
});

describe("no-non-tracked-variant-movements invariant", () => {
  it("fails when M4 void_counter_sale does not filter track_stock = true", () => {
    const dir = createFixtureTree();
    const migs = path.join(dir, "supabase", "migrations");
    fs.mkdirSync(migs, { recursive: true });
    fs.writeFileSync(
      path.join(migs, "20261113231100_void.sql"),
      "CREATE FUNCTION public.void_counter_sale() RETURNS void AS $$ INSERT INTO stock_movements SELECT * FROM counter_sale_lines; $$;"
    );

    const r = runChecker(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("void_counter_sale must filter track_stock = true for movements");
  });

  it("passes when M4 migrations properly guard and filter track_stock", () => {
    const dir = createFixtureTree();
    const migs = path.join(dir, "supabase", "migrations");
    fs.mkdirSync(migs, { recursive: true });
    fs.writeFileSync(
      path.join(migs, "20261113231100_void.sql"),
      "CREATE FUNCTION public.void_counter_sale() RETURNS void AS $$ WHERE track_stock = true; $$;"
    );

    const r = runChecker(dir);
    expect(r.stdout).not.toContain("no-non-tracked-variant-movements 1 total, 1 new");
  });
});
