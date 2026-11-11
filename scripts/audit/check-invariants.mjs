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

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// --root <dir> scans another tree (used by the fixture test); the baseline stays this repo's.
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : SCRIPT_ROOT;
const BASELINE = path.join(SCRIPT_ROOT, 'scripts', 'audit', 'baseline.json');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.migration-backup', '.turbo', 'playwright-report', 'test-results',
  '.claude', '.agent-runs',
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
// Migrations from M1 on (20261104...), whatever their exact timestamp.
const isPostM1Migration = (r) => (/^supabase\/migrations\/(\d{14})/.exec(r)?.[1] ?? '') >= '20261104000000';

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
        'stocktakes',
        'stocktake_lines',
        'suppliers',
        'products',
        'product_variants',
        'orders',
        'order_items',
        'cart_items',
        'users',
        'counter_sales',
        'counter_sale_lines',
        'bundles',
        'bundle_lines',
      ]);
      const costColPat = /\b(unit_cost|cost_price|total_cost|additional_costs|cogs|supplier_price)\b/i;
      const hits = [];
      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        const r = rel(file);
        // Only inspect current schema.sql and migrations starting from M2a
        if (!isPostM1Migration(r) && r !== 'supabase/schema.sql') continue;

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
    id: 'no-private-columns-on-anon-grants',
    why: 'No view or table granted to anon may expose columns matching /reserved|deficit|cost|margin/i.',
    run: (files) => {
      const hits = [];
      const forbiddenColPat = /\b(reserved|deficit|cost|margin)\w*\b/i;

      for (const { file, text } of files) {
        if (!isSql(file)) continue;
        const r = rel(file);
        if (!/^supabase\/migrations\//.test(r) && r !== 'supabase/schema.sql') continue;

        // Find objects granted to anon
        const grantRe = /GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?(?:public\.)?([\w.]+)\s+TO\s+[^;]*\banon\b/gi;
        let match;
        const grantedObjects = new Set();
        while ((match = grantRe.exec(text)) !== null) {
          const objName = match[1].split('.').pop();
          grantedObjects.add(objName);
        }

        for (const obj of grantedObjects) {
          // Find CREATE VIEW definition
          const viewRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:public\\.)?${obj}\\b[\\s\\S]*?AS\\s*SELECT([\\s\\S]*?)(?:FROM|;)`, 'i');
          const vMatch = text.match(viewRe);
          if (vMatch) {
            const selectBody = vMatch[1];
            selectBody.split('\n').forEach((line, i) => {
              if (/^\s*--/.test(line)) return;
              if (forbiddenColPat.test(line)) {
                hits.push({
                  file: r,
                  line: i + 1,
                  text: `View "${obj}" granted to anon exposes forbidden column: ${line.trim()}`,
                });
              }
            });
          }

          // Find CREATE TABLE definition
          const tableRe = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${obj}\\b[\\s\\S]*?\\(([\\s\\S]*?)\\);`, 'i');
          const tMatch = text.match(tableRe);
          if (tMatch) {
            const tableBody = tMatch[1];
            tableBody.split('\n').forEach((line, i) => {
              if (/^\s*--/.test(line)) return;
              if (forbiddenColPat.test(line)) {
                hits.push({
                  file: r,
                  line: i + 1,
                  text: `Table "${obj}" granted to anon exposes forbidden column: ${line.trim()}`,
                });
              }
            });
          }
        }
      }
      return hits;
    },
  },
  {
    id: 'no-expected-quantity-on-staff-endpoints',
    why: 'Staff endpoints and staff-facing tables must never expose snapshot or expected quantities, preserving blind counting.',
    run: (files) => {
      const hits = [];
      const forbiddenPropPat = /\b(snapshot_on_hand|expected_quantity)\b/i;

      for (const { file, text } of files) {
        const r = rel(file);

        // 1. Check migrations/schema: stocktakes and stocktake_lines tables must not contain snapshot or expected_quantity
        if (isSql(file)) {
          if (!isPostM1Migration(r) && r !== 'supabase/schema.sql') continue;
          text.split('\n').forEach((line, i) => {
            if (/^\s*--/.test(line)) return;
            if (/\b(stocktakes|stocktake_lines)\b/i.test(line) && forbiddenPropPat.test(line)) {
              hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
            }
          });
        }

        // 2. Check OpenAPI spec for staff-facing stocktake schemas
        if (r === 'lib/api-spec/openapi.yaml') {
          let inStaffSchema = false;
          text.split('\n').forEach((line, i) => {
            if (/^\s*(StocktakeLine|StocktakeStaffDetail|DraftStocktakeLine):/.test(line)) {
              inStaffSchema = true;
            } else if (/^\s*[A-Z]\w+:/.test(line) && !line.includes('properties:')) {
              inStaffSchema = false;
            }
            if (inStaffSchema && forbiddenPropPat.test(line)) {
              hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
            }
          });
        }
      }
      return hits;
    },
  },
  {
    id: 'security-definer-service-role-privileges',
    why: 'Service-role SECURITY DEFINER functions have no auth.uid() context so must not contain auth.uid/is_admin guards, and must enforce explicit REVOKE/GRANT privileges.',
    run: (files) => {
      // Migrations from M1 on, in apply order: a later migration may fix an earlier grant.
      const migs = files
        .filter(({ file }) => isSql(file) && isPostM1Migration(rel(file)))
        .sort((a, b) => rel(a.file).localeCompare(rel(b.file)));

      const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(.*?\)\s*RETURNS\s+(\w+)(.*?)\$(\w*)\$(.*?)\$\4\$([^;]*);/gis;
      const grantRe = /\b(GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+([\w.]+)\s*\(.*?\)\s+(?:TO|FROM)\s+([^;]+);/gis;

      const definers = new Map(); // name -> file of last definition
      // Supabase's default privileges grant EXECUTE on new public functions to anon and
      // authenticated directly, so REVOKE ... FROM public alone removes nothing.
      const roles = new Map(); // name -> Set of roles holding EXECUTE
      const hits = [];

      for (const { file, text } of migs) {
        const r = rel(file);
        // Statements in file order, so a REVOKE after a CREATE in the same file applies.
        const events = [];
        for (const m of text.matchAll(fnRe)) events.push({ at: m.index, fn: m });
        for (const m of text.matchAll(grantRe)) events.push({ at: m.index, grant: m });
        events.sort((a, b) => a.at - b.at);

        for (const e of events) {
          if (e.fn) {
            const [, qname, returns, pre, , body, post] = e.fn;
            const name = qname.split('.').pop();
            if (!/SECURITY\s+DEFINER/i.test(pre + post) || /^trigger$/i.test(returns)) continue;
            definers.set(name, r);
            if (!roles.has(name)) roles.set(name, new Set(['public', 'anon', 'authenticated']));
            if (/\b(auth\.uid\(\)|is_admin\(\))/i.test(body)) {
              hits.push({ file: r, line: 0, text: `SECURITY DEFINER function "${name}" contains auth.uid() or is_admin() which fails when called via service role client` });
            }
          } else {
            const [, verb, qname, list] = e.grant;
            const set = roles.get(qname.split('.').pop());
            if (!set) continue;
            for (const role of list.split(',').map((s) => s.trim().toLowerCase())) {
              verb.toUpperCase() === 'GRANT' ? set.add(role) : set.delete(role);
            }
          }
        }
      }

      for (const [name, file] of definers) {
        const set = roles.get(name);
        const open = ['public', 'anon', 'authenticated'].filter((role) => set.has(role));
        if (open.length || !set.has('service_role')) {
          hits.push({
            file,
            line: 0,
            text: `SECURITY DEFINER function "${name}" ends with EXECUTE for ${open.join(', ') || 'no client role'}${set.has('service_role') ? '' : ', missing service_role'}; revoke FROM public, anon, authenticated and grant TO service_role`,
          });
        }
      }
      return hits;
    },
  },
  {
    id: 'no-client-insert-policy-on-stock-movements',
    why: 'Every ledger write goes through Express or a definer function. An INSERT (or ALL) policy on stock_movements lets a client token forge movements through PostgREST.',
    run: (files) => {
      const migs = files
        .filter(({ file }) => isSql(file) && /^supabase\/migrations\//.test(rel(file)))
        .sort((a, b) => rel(a.file).localeCompare(rel(b.file)));
      const createRe = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?stock_movements\b([^;]*);/gi;
      const dropRe = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?stock_movements\b/gi;
      const live = new Map(); // policy name -> file that created it
      for (const { file, text } of migs) {
        const events = [
          ...[...text.matchAll(createRe)].map((m) => ({ at: m.index, create: m })),
          ...[...text.matchAll(dropRe)].map((m) => ({ at: m.index, drop: m })),
        ].sort((a, b) => a.at - b.at);
        for (const e of events) {
          if (e.drop) { live.delete(e.drop[1]); continue; }
          const [, name, rest] = e.create;
          const cmd = /\bFOR\s+(\w+)/i.exec(rest)?.[1].toUpperCase() ?? 'ALL';
          if (cmd === 'INSERT' || cmd === 'ALL') live.set(name, rel(file));
        }
      }
      return [...live].map(([name, file]) => ({ file, line: 0, text: `Policy "${name}" allows client INSERT on stock_movements` }));
    },
  },
  {
    id: 'stocktake-mutations-check-draft-status',
    why: 'Service-role route mutations on stocktakes or stocktake_lines bypass RLS and must explicitly verify draft status to protect posted audit trails.',
    run: (files) => {
      const hits = [];
      for (const { file, text } of files) {
        const r = rel(file);
        if (!r.startsWith('artifacts/api-server/src/routes/')) continue;
        if (!isCode(file)) continue;

        const routeRegex = /router\.(post|patch|put|delete)\s*\(\s*["']([^"']+)["'][\s\S]*?(?=\nrouter\.(?:post|patch|put|delete|get)|export\s+default|$)/g;
        let match;
        while ((match = routeRegex.exec(text)) !== null) {
          const method = match[1];
          const routePath = match[2];
          const handlerCode = match[0];

          const mutatesStocktakes = /\.from\s*\(\s*["'](?:stocktakes|stocktake_lines)["']\s*\)\s*\.\s*(?:insert|update|delete)\b/.test(handlerCode);
          if (mutatesStocktakes) {
            const checksStatus = /\bstatus\b/.test(handlerCode);
            if (!checksStatus) {
              const line = text.slice(0, match.index).split('\n').length;
              hits.push({
                file: r,
                line,
                text: `${method.toUpperCase()} ${routePath} mutates stocktake tables without referencing status`,
              });
            }
          }
        }
      }
      return hits;
    },
  },
  {
    id: 'no-on-hand-reads-on-storefront',
    why: 'Public storefront paths must read availability, never raw physical on_hand.',
    run: (files) => {
      const hits = [];
      const STOREFRONT_PAT = /^artifacts\/store\/src\/(pages|components)\/storefront\//;
      const onHandPat = /\bon_hand\b/;
      for (const { file, text } of files) {
        if (!isCode(file)) continue;
        const r = rel(file);
        if (!STOREFRONT_PAT.test(r)) continue;
        text.split('\n').forEach((line, i) => {
          if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
          if (onHandPat.test(line)) {
            hits.push({ file: r, line: i + 1, text: line.trim().slice(0, 140) });
          }
        });
      }
      return hits;
    },
  },
  {
    id: 'no-sensitive-columns-in-exposed-views',
    why: 'A CREATE VIEW granted to anon or authenticated must set security_invoker = true or expose no sensitive columns.',
    run: (files) => {
      const hits = [];
      const SENSITIVE_COLS = /customer_name|customer_phone|agreed_price|paid_amount|reserved_quantity|deficit_quantity|cost|margin/i;

      function stripSqlComments(sql) {
        return sql
          .replace(/--.*$/gm, (m) => ' '.repeat(m.length))
          .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '));
      }

      function parseViewDefinitions(rawSqlText) {
        const cleanSql = stripSqlComments(rawSqlText);
        const views = new Map();
        const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:(?:"?public"?\.)?"?(\w+)"?)\s+AS\s+SELECT([\s\S]*?)(?:\bFROM\s+(?:public\.)?[\w."]+|\n\s*FROM\s+)/gi;
        let match;
        while ((match = viewRe.exec(cleanSql)) !== null) {
          const viewName = match[1];
          const selectBody = match[2];
          const line = rawSqlText.slice(0, match.index).split('\n').length;
          const sensitiveMatches = [];
          for (const rawLine of selectBody.split('\n')) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue;
            if (SENSITIVE_COLS.test(trimmed)) {
              sensitiveMatches.push(trimmed.slice(0, 100));
            }
          }
          views.set(viewName, {
            name: viewName,
            line,
            selectBody,
            hasSensitiveCols: sensitiveMatches.length > 0,
            sensitiveMatches,
          });
        }
        return views;
      }

      // 1. Check supabase/schema.sql
      const schemaFile = files.find((f) => rel(f.file) === 'supabase/schema.sql');
      if (schemaFile) {
        const rawText = schemaFile.text;
        const text = stripSqlComments(rawText);
        const views = parseViewDefinitions(rawText);

        for (const [viewName, info] of views) {
          const invokerRe = new RegExp(`ALTER\\s+VIEW\\s+(?:(?:"?public"?\\.)?"?${viewName}"?)\\s+SET\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i');
          const inlineInvokerRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:(?:"?public"?\\.)?"?${viewName}"?)\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i');
          const hasSecurityInvoker = invokerRe.test(text) || inlineInvokerRe.test(text);

          let grantedToAnon = false;
          let grantedToAuth = false;

          const stmtRe = new RegExp(`\\b(GRANT|REVOKE)\\s+([A-Za-z,\\s]+?)\\s+ON\\s+(?:TABLE\\s+|VIEW\\s+)?(?:(?:"?public"?\\.)?"?${viewName}"?)\\b\\s+(TO|FROM)\\s+([^;]+);`, 'gi');
          let stmtMatch;
          while ((stmtMatch = stmtRe.exec(text)) !== null) {
            const action = stmtMatch[1].toUpperCase();
            const targets = stmtMatch[4].toLowerCase();
            const hasAnon = /\banon\b/.test(targets);
            const hasAuth = /\bauthenticated\b/.test(targets);

            if (action === 'GRANT') {
              if (hasAnon) grantedToAnon = true;
              if (hasAuth) grantedToAuth = true;
            } else if (action === 'REVOKE') {
              if (hasAnon || /\ball\b/.test(stmtMatch[2].toLowerCase())) {
                grantedToAnon = false;
              }
              if (hasAuth || /\ball\b/.test(stmtMatch[2].toLowerCase())) {
                grantedToAuth = false;
              }
            }
          }

          const isExposed = grantedToAnon || grantedToAuth;
          if (isExposed && info.hasSensitiveCols && !hasSecurityInvoker) {
            hits.push({
              file: 'supabase/schema.sql',
              line: info.line,
              text: `View "${viewName}" exposed to ${grantedToAnon ? 'anon ' : ''}${grantedToAuth ? 'authenticated' : ''} contains sensitive columns without security_invoker = true`,
            });
          }
        }
      }

      // 2. Check migrations in timestamp order
      const migrationFiles = files
        .filter((f) => /^supabase\/migrations\/.*\.sql$/.test(rel(f.file)))
        .sort((a, b) => rel(a.file).localeCompare(rel(b.file)));

      const migrationViews = new Map();

      for (const mf of migrationFiles) {
        const rawText = mf.text;
        const text = stripSqlComments(rawText);
        const r = rel(mf.file);
        const defs = parseViewDefinitions(rawText);

        for (const [vName, info] of defs) {
          migrationViews.set(vName, {
            ...info,
            file: r,
            hasSecurityInvoker: false,
            grantedToAnon: false,
            grantedToAuth: false,
          });
        }

        for (const [vName, state] of migrationViews) {
          const invokerRe = new RegExp(`ALTER\\s+VIEW\\s+(?:(?:"?public"?\\.)?"?${vName}"?)\\s+SET\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i');
          const inlineInvokerRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:(?:"?public"?\\.)?"?${vName}"?)\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i');
          if (invokerRe.test(text) || inlineInvokerRe.test(text)) {
            state.hasSecurityInvoker = true;
          }

          const stmtRe = new RegExp(`\\b(GRANT|REVOKE)\\s+([A-Za-z,\\s]+?)\\s+ON\\s+(?:TABLE\\s+|VIEW\\s+)?(?:(?:"?public"?\\.)?"?${vName}"?)\\b\\s+(TO|FROM)\\s+([^;]+);`, 'gi');
          let stmtMatch;
          while ((stmtMatch = stmtRe.exec(text)) !== null) {
            const action = stmtMatch[1].toUpperCase();
            const targets = stmtMatch[4].toLowerCase();
            const hasAnon = /\banon\b/.test(targets);
            const hasAuth = /\bauthenticated\b/.test(targets);

            if (action === 'GRANT') {
              if (hasAnon) state.grantedToAnon = true;
              if (hasAuth) state.grantedToAuth = true;
            } else if (action === 'REVOKE') {
              if (hasAnon || /\ball\b/.test(stmtMatch[2].toLowerCase())) {
                state.grantedToAnon = false;
              }
              if (hasAuth || /\ball\b/.test(stmtMatch[2].toLowerCase())) {
                state.grantedToAuth = false;
              }
            }
          }
        }
      }

      for (const [vName, state] of migrationViews) {
        const isExposed = state.grantedToAnon || state.grantedToAuth;
        if (isExposed && state.hasSensitiveCols && !state.hasSecurityInvoker) {
          hits.push({
            file: state.file,
            line: state.line,
            text: `View "${vName}" exposed to ${state.grantedToAnon ? 'anon ' : ''}${state.grantedToAuth ? 'authenticated' : ''} contains sensitive columns without security_invoker = true`,
          });
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
