import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const checker = path.resolve(import.meta.dirname, "../../../../scripts/audit/check-invariants.mjs");

let tmpDir = "";
function runFixture(code: string, rel = "artifacts/api-server/src/middlewares/fixture.ts") {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-meta-"));
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code);
  return spawnSync(process.execPath, [checker, "--root", tmpDir], { encoding: "utf8" });
}
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("no-auth-metadata-role-reads invariant", () => {
  const bad: Array<[string, string]> = [
    ["user_metadata.role", "const r = user.user_metadata.role;"],
    ["user_metadata?.role", "const r = user.user_metadata?.role;"],
    ["app_metadata.role", "const r = user.app_metadata.role;"],
    ["app_metadata?.role", "const r = user.app_metadata?.role;"],
    ['user_metadata["role"]', 'const r = user.user_metadata["role"];'],
    ["app_metadata?.['role']", "const r = user.app_metadata?.['role'];"],
  ];
  for (const [name, code] of bad) {
    it(`fails on ${name}`, () => {
      const r = runFixture(code);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("no-auth-metadata-role-reads");
    });
  }

  it("passes when role comes from the profile and metadata is only written", () => {
    const r = runFixture(`
      const role = profile?.role;
      await admin.auth.admin.createUser({ phone, app_metadata: { role: "staff" } });
      const name = user.user_metadata?.full_name;
    `);
    expect(r.stdout).toMatch(/ok\s+no-auth-metadata-role-reads\s+0 total/);
  });

  it("ignores files outside artifacts/api-server/src", () => {
    const r = runFixture("const r = user.user_metadata.role;", "artifacts/store/src/x.ts");
    expect(r.stdout).toMatch(/ok\s+no-auth-metadata-role-reads\s+0 total/);
  });
});
