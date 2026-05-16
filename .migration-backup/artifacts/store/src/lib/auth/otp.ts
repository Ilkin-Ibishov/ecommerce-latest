import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/server";

const OTP_EXPIRY_MINUTES = 3;
const MAX_ATTEMPTS = 3;
const MAX_REQUESTS_PER_HOUR = 5;
const RESEND_COOLDOWN_SECONDS = 60;

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function hashOTP(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyOTPHash(
  code: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("994")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+994${cleaned.slice(1)}`;
  return `+994${cleaned}`;
}

export function validateAzPhone(phone: string): boolean {
  const formatted = formatPhone(phone);
  return /^\+994\d{9}$/.test(formatted);
}

export async function checkRateLimit(
  phone: string
): Promise<{ allowed: boolean; reason?: string }> {
  const supabase = await createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("otp_codes")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
    return { allowed: false, reason: "rate_limit_hour" };
  }

  const cooldownAgo = new Date(
    Date.now() - RESEND_COOLDOWN_SECONDS * 1000
  ).toISOString();
  const { data: recent } = await supabase
    .from("otp_codes")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", cooldownAgo)
    .limit(1);

  if (recent && recent.length > 0) {
    return { allowed: false, reason: "cooldown" };
  }

  return { allowed: true };
}

export async function createOTP(phone: string): Promise<string> {
  const supabase = await createAdminClient();
  const code = generateOTP();
  const codeHash = await hashOTP(code);
  const expiresAt = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();

  // Invalidate any existing OTPs for this phone
  await supabase
    .from("otp_codes")
    .update({ verified: true })
    .eq("phone", phone)
    .eq("verified", false);

  const { error } = await supabase.from("otp_codes").insert({
    phone,
    code_hash: codeHash,
    expires_at: expiresAt,
    attempts: 0,
    verified: false,
  });

  if (error) throw new Error(`Failed to create OTP: ${error.message}`);

  return code;
}

export async function verifyOTP(
  phone: string,
  code: string
): Promise<{ success: boolean; reason?: string }> {
  const supabase = await createAdminClient();
  const now = new Date().toISOString();

  const { data: otpRecord } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("phone", phone)
    .eq("verified", false)
    .gt("expires_at", now)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!otpRecord) {
    return { success: false, reason: "not_found_or_expired" };
  }

  // Increment attempts
  await supabase
    .from("otp_codes")
    .update({ attempts: otpRecord.attempts + 1 })
    .eq("id", otpRecord.id);

  const valid = await verifyOTPHash(code, otpRecord.code_hash);

  if (!valid) {
    if (otpRecord.attempts + 1 >= MAX_ATTEMPTS) {
      return { success: false, reason: "max_attempts" };
    }
    return { success: false, reason: "invalid_code" };
  }

  // Mark as verified
  await supabase
    .from("otp_codes")
    .update({ verified: true })
    .eq("id", otpRecord.id);

  return { success: true };
}
