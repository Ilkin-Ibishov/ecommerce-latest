import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Admin.Nav.reservations shipped missing from all three dictionaries through three green CI
// runs. The check that catches it parses the az dictionary by hand, so a parser that silently
// matches nothing would look exactly like a pass. Feed it known fixtures.
const checker = path.resolve(import.meta.dirname, "../../../../scripts/audit/check-invariants.mjs");

// The real dictionary has ~1460 keys and the check refuses to trust a parse under 500, so the
// fixture has to be padded. HomePage.hero.title is the check's own sanity anchor.
const dict = (extra: string) => {
  const filler = Array.from({ length: 600 }, (_, i) => `      k${i}: "v${i}",`).join("\n");
  return `const az = {
    HomePage: {
      hero: {
        title: "Ən yaxşı məhsullar burada",
      },
    },
    Filler: {
      deep: {
${filler}
      },
    },
    Admin: {
      Nav: {
        counter: "Kassa",
${extra}
      },
    },
  };

export default az;
`;
};

let dir = "";
function run(dictExtra: string, usage: string) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-i18n-"));
  const msgs = path.join(dir, "artifacts", "store", "src", "lib", "i18n", "messages");
  const pages = path.join(dir, "artifacts", "store", "src", "pages");
  fs.mkdirSync(msgs, { recursive: true });
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(msgs, "az.ts"), dict(dictExtra));
  fs.writeFileSync(path.join(pages, "Thing.tsx"), usage);
  return spawnSync(process.execPath, [checker, "--root", dir], { encoding: "utf8" });
}
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("i18n-keys-exist-in-dictionaries", () => {
  it("fails on a t() key that no dictionary defines", () => {
    const r = run("", `export const X = () => <a>{t("Admin.Nav.reservations")}</a>;\n`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('i18n key "Admin.Nav.reservations" is not in the dictionaries');
  });

  it("fails on a labelKey that no dictionary defines", () => {
    const r = run("", `export const opts = [{ labelKey: "Admin.Nav.reservations" }];\n`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('i18n key "Admin.Nav.reservations" is not in the dictionaries');
  });

  it("passes once the key is added", () => {
    const r = run(`        reservations: "Rezervasiyalar",`, `export const X = () => <a>{t("Admin.Nav.reservations")}</a>;\n`);
    expect(r.stdout).toMatch(/ok\s+i18n-keys-exist-in-dictionaries\s+0 total/);
  });

  it("ignores a bare, undotted t() argument", () => {
    const r = run("", `export const X = () => <a>{t("notADictionaryPath")}</a>;\n`);
    expect(r.stdout).toMatch(/ok\s+i18n-keys-exist-in-dictionaries\s+0 total/);
  });

  it("reports the parser, not the dictionary, when the dictionary cannot be parsed", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-i18n-"));
    const msgs = path.join(dir, "artifacts", "store", "src", "lib", "i18n", "messages");
    fs.mkdirSync(msgs, { recursive: true });
    fs.writeFileSync(path.join(msgs, "az.ts"), `const az = {};\nexport default az;\n`);
    const r = spawnSync(process.execPath, [checker, "--root", dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("the parser, not the dictionary, is wrong");
  });
});
