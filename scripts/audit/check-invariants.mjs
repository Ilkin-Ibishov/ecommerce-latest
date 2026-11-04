#!/usr/bin/env node
/**
 * Architectural invariant checks.
 *
 * Prose invariants get violated silently; these do not. Every finding an audit produces that can
 * be expressed mechanically should end up here, so the same defect never needs a human eye twice.
 *
 * Usage:
 *   node scripts/audit/check-invariants.mjs                 # fail on NEW violations only
 *   node scripts/audit/check-invariants.mjs --strict        # fail if any violation remains
 *   node scripts/audit/check-invariants.mjs --update-baseline
 *
 * The baseline records violations that already existed when a check was introduced, so a check can
 * be adopted before the debt behind it is paid. A phase that claims to fix one must shrink it.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'scripts', 'audit', 'baseline.json');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.migration-backup', '.turbo', 'playwright-report', 'test-results',
]);

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const UPDATE = args.includes('--update-baseline');

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const isCode = (f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f);
const isSql = (f) => /\.sql$/.test(f);

/* ------------------------------------------------------------------ checks */

/**
 * Files permitted to change a quantity directly. Everything else must go through them.
 * Keep this list SHORT — it is the blast radius of the ledger invariant.
 */
const LEDGER_ALLOWLIST = [
  /^artifacts\/api-server\/src\/lib\/inventory\//,
  /^supabase\/migrations\/\d+_.*(ledger|stock_movement)/,
  /^scripts\/audit\//,
];

const checks = [
  {
    id: 'ledger-only-stock-writes',
    why: 'Every quantity change must produce a movement row. A direct write bypasses the ledger.',
    run: (files) => {
      const pat = /(\.update\(\s*\{[^}]*\bstock\b)|(\bset\s+stock\s*=)|(\bstock\s*:\s*\w+\s*,?\s*\}\s*\)\s*\.eq\()/i;
      const hits = [];
      for (const { file, text } of files) {
        if (!isCode(file) && !isSql(file)) continue;
        const r = rel(file);
        if (LEDGER_ALLOWLIST.some((re) => re.test(r))) continue;
        text.split('\n').forEach((line, i) => {
          if (pat.test(line)) hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
        });
      }
      return hits;
    },
  },
  {
    id: 'rls-on-new-tables',
    why: 'A table without RLS leaks across tenants in a multi-tenant product.',
    run: (files) => {
      const hits = [];
      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        const lower = text.toLowerCase();
        const created = [...lower.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/g)]
          .map((m) => m[1].replace(/"/g, '').split('.').pop());
        if (!created.length) continue;
        for (const t of created) {
          const re = new RegExp(`alter\\s+table\\s+[\\w."]*${t}[\\w."]*\\s+enable\\s+row\\s+level\\s+security`);
          if (!re.test(lower)) hits.push({ file: rel(file), line: 0, text: `table "${t}" created without RLS in this file` });
        }
      }
      return hits;
    },
  },
];

checks.push(
  {
    id: 'no-has-variants-flag',
    why: 'Every product has variants; some have one. A flag reintroduces the branch it removes.',
    run: (files) => {
      const hits = [];
      for (const { file, text } of files) {
        if (!isCode(file) && !isSql(file)) continue;
        text.split('\n').forEach((line, i) => {
          if (/\bhas_?[Vv]ariants\b/.test(line))
            hits.push({ file: rel(file), line: i + 1, text: line.trim().slice(0, 140) });
        });
      }
      return hits;
    },
  },
  {
    id: 'no-customer-industry-naming',
    why: 'A schema named after the first customer cannot be sold to the second.',
    run: (files) => {
      const banned = /\b(gift|hediyy[eə]|giftbox|flower|pharmac|restaurant)\w*/i;
      const hits = [];
      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        text.split('\n').forEach((line, i) => {
          if (/^\s*(create\s+(table|type)|alter\s+table\s+\S+\s+add\s+column)/i.test(line) && banned.test(line))
            hits.push({ file: rel(file), line: i + 1, text: line.trim().slice(0, 140) });
        });
      }
      return hits;
    },
  },
  {
    id: 'reservations-are-not-movements',
    why: 'A reservation does not change what is physically present; writing it to the ledger corrupts the sum.',
    run: (files) => {
      const hits = [];
      for (const { file, text } of files) {
        const r = rel(file);
        if (!/reserv/i.test(r)) continue;
        if (!isCode(file) && !isSql(file)) continue;
        text.split('\n').forEach((line, i) => {
          if (/insert\s+into\s+[\w."]*stock_movements|from\(['"]stock_movements['"]\)\s*\.insert/i.test(line))
            hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
        });
      }
      return hits;
    },
  },
  {
    id: 'on-hand-repair-setting-isolation',
    why: 'inventory.allow_on_hand_repair bypasses the on_hand guard and must be set only in the repair migration.',
    run: (files) => {
      const ALLOWED = new Set([
        'supabase/migrations/20261104110000_m2a_functions_triggers.sql',
        'scripts/audit/check-invariants.mjs',
      ]);
      const pat = /inventory\.allow_on_hand_repair/;
      const hits = [];
      for (const { file, text } of files) {
        if (!isCode(file) && !isSql(file)) continue;
        const r = rel(file);
        if (ALLOWED.has(r)) continue;
        text.split('\n').forEach((line, i) => {
          if (pat.test(line)) {
            hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
          }
        });
      }
      return hits;
    },
  },
  {
    id: 'no-direct-variant-costs-writes',
    why: 'variant_costs is a cache and opening carrier managed by the inventory cost module, not arbitrary code.',
    run: (files) => {
      const ALLOWED = [
        /^artifacts\/api-server\/src\/lib\/inventory\//,
        /^artifacts\/api-server\/src\/routes\/inventory\.ts$/,
        /^artifacts\/api-server\/src\/routes\/admin\/inventory\.ts$/,
        /^artifacts\/api-server\/src\/routes\/admin\/products\.ts$/,
        /^artifacts\/api-server\/src\/routes\/admin\/receipts\.ts$/,
        /^supabase\/migrations\//,
        /^scripts\/audit\//,
      ];
      const pat = /(from\(['"]variant_costs['"]\)\s*\.(insert|update|upsert|delete))|(insert\s+into\s+[\w."]*variant_costs|update\s+[\w."]*variant_costs)/i;
      const hits = [];
      for (const { file, text } of files) {
        if (!isCode(file) && !isSql(file)) continue;
        const r = rel(file);
        if (ALLOWED.some((re) => re.test(r))) continue;
        if (/\.test\.(ts|js|mjs)$/.test(r) || /\/__tests__\//.test(r)) continue;
        text.split('\n').forEach((line, i) => {
          if (pat.test(line)) {
            hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
          }
        });
      }
      return hits;
    },
  },
  {
    id: 'no-cost-column-on-staff-tables',
    why: 'Staff tokens query PostgREST directly where RLS governs rows, not columns. Staff-accessible tables must not have cost columns.',
    run: (files) => {
      const STAFF_TABLES = new Set([
        'stock_movements',
        'goods_receipts',
        'goods_receipt_lines',
        'suppliers',
        'products',
        'product_variants',
        'orders',
        'order_items',
        'cart_items',
        'users',
      ]);
      const costColPat = /\b(unit_cost|cost_price|total_cost|additional_costs|cogs|supplier_price)\b/i;
      const hits = [];
      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        const r = rel(file);
        // Only inspect current schema.sql and migrations starting from M2a
        const isPostM1Migration = /^supabase\/migrations\/20261104/.test(r);
        const isCurrentSchema = r === 'supabase/schema.sql';
        if (!isPostM1Migration && !isCurrentSchema) continue;

        text.split('\n').forEach((line, i) => {
          if (/^\s*--/.test(line)) return;
          if (/\bdrop\s+column\b/i.test(line)) return;
          for (const tbl of STAFF_TABLES) {
            const tableRe = new RegExp(`\\b${tbl}\\b`, 'i');
            if (tableRe.test(line) && costColPat.test(line)) {
              hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
            }
          }
        });
      }
      return hits;
    },
  },
  {
    id: 'security-definer-service-role-privileges',
    why: 'Service-role SECURITY DEFINER functions have no auth.uid() context so must not contain auth.uid/is_admin guards, and must enforce explicit REVOKE/GRANT privileges.',
    run: (files) => {
      const hits = [];
      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        const r = rel(file);
        if (!/^supabase\/migrations\/20261104/.test(r)) continue;

        const fnPattern = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([\w.]+)\s*\(([^)]*)\)[\s\S]*?LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER[\s\S]*?\$\$(.*?)\$\$;/gi;
        let match;
        while ((match = fnPattern.exec(text)) !== null) {
          const fnName = match[1].split('.').pop();
          const fnBody = match[3];

          // 1. Guard against auth.uid() or is_admin() in body
          if (/\b(auth\.uid\(\)|is_admin\(\))\b/i.test(fnBody)) {
            hits.push({
              file: r,
              line: 0,
              text: `SECURITY DEFINER function "${fnName}" contains auth.uid() or is_admin() which fails when called via service role client`,
            });
          }

          // 2. Guard against missing REVOKE/GRANT
          const revokeRe = new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+[\\w.]*${fnName}\\b[\\s\\S]*?FROM\\s+[^;]*public`, 'i');
          const grantRe = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+[\\w.]*${fnName}\\b[\\s\\S]*?TO\\s+[^;]*service_role`, 'i');

          if (!revokeRe.test(text) || !grantRe.test(text)) {
            hits.push({
              file: r,
              line: 0,
              text: `SECURITY DEFINER function "${fnName}" missing explicit REVOKE ... FROM public or GRANT ... TO service_role`,
            });
          }
        }
      }
      return hits;
    },
  },
);

/* ------------------------------------------------------------------- main */

const key = (c, h) => `${c}|${h.file}|${h.text}`;

const files = [];
for (const f of await walk(ROOT)) {
  if (!isCode(f) && !isSql(f)) continue;
  try {
    const s = await stat(f);
    if (s.size > 2_000_000) continue;
    files.push({ file: f, text: await readFile(f, 'utf8') });
  } catch { /* unreadable, skip */ }
}

let baseline = [];
if (existsSync(BASELINE)) {
  try { baseline = JSON.parse(await readFile(BASELINE, 'utf8')).known ?? []; } catch { baseline = []; }
}
const known = new Set(baseline);

const all = [];
for (const c of checks) for (const h of c.run(files)) all.push({ check: c.id, why: c.why, ...h });

if (UPDATE) {
  const payload = { generated: new Date().toISOString(), known: all.map((h) => key(h.check, h)) };
  await writeFile(BASELINE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`baseline updated: ${payload.known.length} known violation(s)`);
  process.exit(0);
}

const fresh = all.filter((h) => !known.has(key(h.check, h)));
const carried = all.length - fresh.length;

for (const c of checks) {
  const n = all.filter((h) => h.check === c.id).length;
  const f = fresh.filter((h) => h.check === c.id).length;
  console.log(`${f ? 'FAIL' : 'ok  '}  ${c.id.padEnd(32)} ${n} total, ${f} new`);
}

if (fresh.length) {
  console.log('\nNew violations:\n');
  for (const h of fresh) {
    console.log(`  [${h.check}] ${h.file}${h.line ? ':' + h.line : ''}`);
    console.log(`      ${h.text}`);
    console.log(`      why: ${h.why}\n`);
  }
}
if (carried) console.log(`${carried} violation(s) carried in baseline (run with --strict to fail on these).`);

if (fresh.length) { console.error(`\nFAILED: ${fresh.length} new violation(s).`); process.exit(1); }
if (STRICT && carried) { console.error(`\nFAILED (--strict): ${carried} baseline violation(s) remain.`); process.exit(1); }
console.log('\nAll invariant checks passed.');
