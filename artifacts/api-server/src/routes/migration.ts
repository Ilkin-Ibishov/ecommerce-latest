import { Router } from "express";
import { requireAdmin } from "../lib/supabase";

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const MIGRATION_SQL = `
ALTER TABLE comments ADD COLUMN IF NOT EXISTS rating int2 CHECK (rating >= 1 AND rating <= 5);
ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price numeric(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;
CREATE TABLE IF NOT EXISTS product_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_key text NOT NULL,
  spec_value text NOT NULL,
  sort_order int4 NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS product_specs_product_id_idx ON product_specs(product_id);
CREATE TABLE IF NOT EXISTS banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  subtitle text,
  image_url text,
  cta_text text,
  cta_url text,
  sort_order int4 NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banners_active_sort_idx ON banners(active, sort_order);
`;

async function runSql(sql: string): Promise<{ ok: boolean; error?: string }> {
  const endpoints = [
    `${SUPABASE_URL}/pg/query`,
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
  ];

  for (const endpoint of endpoints) {
    try {
      const body = endpoint.includes("exec_sql")
        ? JSON.stringify({ sql_query: sql })
        : JSON.stringify({ query: sql });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
        body,
      });

      if (res.ok) {
        return { ok: true };
      }

      const text = await res.text();
      if (!text.includes("does not exist") && !text.includes("404")) {
        return { ok: false, error: `${endpoint}: ${text}` };
      }
    } catch {
      // try next endpoint
    }
  }

  return { ok: false, error: "No Supabase SQL endpoint available. Run the SQL manually in Supabase Studio." };
}

router.post("/admin/migrate", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });

    const statements = MIGRATION_SQL
      .split("\n")
      .map(l => l.trim())
      .join("\n")
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const results: Array<{ sql: string; ok: boolean; error?: string }> = [];

    for (const stmt of statements) {
      const result = await runSql(stmt + ";");
      results.push({ sql: stmt.split("\n")[0], ...result });
    }

    const allOk = results.every(r => r.ok);

    return res.json({
      ok: allOk,
      results,
      manualSql: allOk ? undefined : MIGRATION_SQL,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/admin/migrate/sql", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    return res.json({ sql: MIGRATION_SQL });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
