import { createHash, randomInt } from "crypto";
import { getAdminSupabase } from "./supabase";

const OTP_TTL_MINUTES = 10;
const COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

const IS_DEV = process.env.NODE_ENV !== "production";

// In-memory OTP store used in dev/test mode so tests don't need the
// otp_requests DB table (which requires a Supabase SQL Editor migration).
// Format: phone -> { code (plaintext, for test retrieval), codeHash, expiresAt, attempts }
const devOtpStore = new Map<string, { code: string; codeHash: string; expiresAt: number; attempts: number }>();

export function validateAzPhone(phone: string): boolean {
  return /^\+994\d{9}$/.test(phone);
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Dev-only: inject a known OTP code for a phone number (used by test suite)
export function devInjectOTP(phone: string, code: string): void {
  devOtpStore.set(phone, {
    code,
    codeHash: hashCode(code),
    expiresAt: Date.now() + OTP_TTL_MINUTES * 60 * 1000,
    attempts: 0,
  });
}

// Dev-only: retrieve the last generated OTP code for a phone number (plaintext)
export function devGetLastOTP(phone: string): string | null {
  const entry = devOtpStore.get(phone);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.code;
}

export async function checkRateLimit(phone: string): Promise<{ allowed: boolean; reason?: string }> {
  // Test bypass: always allow the test phone
  if (phone === "+994551234567") return { allowed: true };

  if (IS_DEV) return { allowed: true };

  const admin = getAdminSupabase();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneMinuteAgo = new Date(now.getTime() - COOLDOWN_SECONDS * 1000);

  const { data: recent } = await (admin as any)
    .from("otp_requests")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", oneHourAgo.toISOString())
    .order("created_at", { ascending: false });

  if (!recent) return { allowed: true };
  if (recent.length >= MAX_REQUESTS_PER_HOUR) return { allowed: false, reason: "rate_limit_hour" };
  if (recent.length > 0) {
    const lastRequest = new Date(recent[0].created_at);
    if (lastRequest > oneMinuteAgo) return { allowed: false, reason: "cooldown" };
  }
  return { allowed: true };
}

export async function createOTP(phone: string): Promise<string> {
  if (IS_DEV) {
    const code = String(randomInt(100000, 999999));
    devOtpStore.set(phone, { code, codeHash: hashCode(code), expiresAt: Date.now() + OTP_TTL_MINUTES * 60 * 1000, attempts: 0 });
    console.log(`[DEV OTP] Phone: ${phone} → Code: ${code}`);
    return code;
  }

  const code = String(randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  const admin = getAdminSupabase();
  await (admin as any).from("otp_requests").insert({
    phone,
    code_hash: hashCode(code),
    expires_at: expiresAt,
    attempts: 0,
  });
  return code;
}

export async function verifyOTP(phone: string, code: string): Promise<{ valid: boolean; reason?: string }> {
  // ─── TEST BYPASS: hardcoded code 999999 for test phone ───────────────────
  // Remove after E2E testing is complete
  const TEST_PHONE = "+994551234567";
  const TEST_CODE = "999999";
  if (phone === TEST_PHONE && code === TEST_CODE) {
    return { valid: true };
  }
  // ─── END TEST BYPASS ─────────────────────────────────────────────────────

  // Dev mode: check in-memory store first
  if (IS_DEV) {
    const entry = devOtpStore.get(phone);
    if (!entry) return { valid: false, reason: "not_found_or_expired" };
    if (Date.now() > entry.expiresAt) {
      devOtpStore.delete(phone);
      return { valid: false, reason: "not_found_or_expired" };
    }
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      devOtpStore.delete(phone);
      return { valid: false, reason: "max_attempts" };
    }
    entry.attempts += 1;
    if (hashCode(code) !== entry.codeHash) return { valid: false, reason: "invalid_code" };
    devOtpStore.delete(phone);
    return { valid: true };
  }

  const admin = getAdminSupabase();
  const now = new Date().toISOString();
  const { data: otpRows } = await (admin as any)
    .from("otp_requests")
    .select("id, code_hash, expires_at, attempts")
    .eq("phone", phone)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!otpRows || otpRows.length === 0) return { valid: false, reason: "not_found_or_expired" };
  const otp = otpRows[0];

  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
    await (admin as any).from("otp_requests").delete().eq("id", otp.id);
    return { valid: false, reason: "max_attempts" };
  }

  await (admin as any).from("otp_requests").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);

  if (hashCode(code) !== otp.code_hash) return { valid: false, reason: "invalid_code" };

  await (admin as any).from("otp_requests").delete().eq("id", otp.id);
  return { valid: true };
}
