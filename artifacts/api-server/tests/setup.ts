import { config } from "dotenv";
import { resolve } from "path";
import { resolveSupabaseEnv } from "../src/lib/env";

// Load .env from repo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

// Normalize VITE_-prefixed vars to their non-prefixed equivalents
// (the .env file uses VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for the frontend,
//  but tests and the api-server also accept the non-prefixed form)
const resolvedEnv = resolveSupabaseEnv(process.env);
if (!process.env.SUPABASE_URL && resolvedEnv.url) {
  process.env.SUPABASE_URL = resolvedEnv.url;
}
if (!process.env.SUPABASE_ANON_KEY && resolvedEnv.anonKey) {
  process.env.SUPABASE_ANON_KEY = resolvedEnv.anonKey;
}

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
] as const;

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    throw new Error(
      `Missing required environment variable: ${varName}. ` +
        `Ensure it is defined in .env or .env.test at the repository root.`
    );
  }
}

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters long.");
}

// Ensure dev mode for OTP dev store
process.env.NODE_ENV = "development";
