import { Router } from "express";
import { createHmac } from "crypto";
import { getAdminSupabase, getSupabase } from "../lib/supabase";
import { validateAzPhone, checkRateLimit, createOTP, verifyOTP, normalizePhone } from "../lib/otp";
import { sendWhatsAppOTP } from "../lib/whatsapp";
import { authRateLimit } from "../middlewares/rateLimits";

const router = Router();

// ─── OTP Request ──────────────────────────────────────────────────────────────
router.post("/auth/otp/request", authRateLimit, async (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Phone number is required" });
  }
  if (!validateAzPhone(phone)) {
    return res.status(400).json({ error: "Invalid Azerbaijan phone number format" });
  }
  const rateCheck = await checkRateLimit(phone);
  if (!rateCheck.allowed) {
    return res.status(429).json({ error: "Rate limit exceeded", reason: rateCheck.reason });
  }
  const code = await createOTP(phone);
  await sendWhatsAppOTP(phone, code);
  return res.json({ success: true });
});

// ─── OTP Verify ───────────────────────────────────────────────────────────────
router.post("/auth/otp/verify", authRateLimit, async (req, res): Promise<void> => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    res.status(400).json({ error: "Phone and code are required" });
    return;
  }

  // 1. Verify against our custom OTP table
  const result = await verifyOTP(phone, code);
  if (!result.valid) {
    res.status(400).json({ error: "Verification failed", reason: result.reason });
    return;
  }

  const admin = getAdminSupabase();

  // Canonical phone used consistently for the public.users lookup, the Auth
  // createUser/upsert writes, and the listUsers recovery match — so a
  // stored-vs-queried format difference can no longer cause a false miss.
  const normalizedPhone = normalizePhone(phone);
  // Supabase Auth stores phones WITHOUT the leading "+" (e.g. "994550000001").
  const authPhone = normalizedPhone.replace(/^\+/, "");

  // 2. Find or create the Supabase Auth user
  let userId: string;
  let isNew = false;

  const { data: existingRow } = await (admin as any)
    .from("users")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (existingRow) {
    userId = existingRow.id;
  } else {
    // Create the user in Supabase Auth with phone confirmed
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone: normalizedPhone,
      phone_confirm: true,
    });

    if (createErr) {
      // User might already exist in auth but not in public.users.
      // Null-guard the listUsers recovery: a null/undefined `data` (error-shape
      // response or SDK edge) must yield a SPECIFIC handled error rather than an
      // unhandled TypeError from a nested destructure → generic 500.
      const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr || !listData?.users) {
        req.log.error({ err: listErr }, "[OTP Verify] listUsers recovery failed");
        res.status(500).json({ error: "Session creation failed", detail: listErr?.message });
        return;
      }
      // Auth stores phones without "+": match on the digits-only canonical form.
      const found = listData.users.find((u) => u.phone === authPhone);
      if (!found) {
        res.status(500).json({ error: createErr.message });
        return;
      }
      userId = found.id;
    } else {
      userId = created.user.id;
      isNew = true;
    }

    // Ensure public.users row exists
    await (admin as any).from("users").upsert({
      id: userId,
      phone: normalizedPhone,
      role: "customer",
    }, { onConflict: "id" });
  }

  // 3. Issue a session token.
  //    This Supabase project's GoTrue version does not expose createSession or
  //    /admin/users/{id}/session. Workaround: stamp a deterministic internal
  //    email + password on the phone-only user via the admin API, then call
  //    signInWithPassword to get a real access/refresh token pair.
  //    The "email" uses a non-routable .internal domain and never conflicts with
  //    real addresses. The password is stable per user, derived from the userId.
  const tempEmail = `${authPhone}@phoneauth.internal`;
  // SEC-010: Derive session password from HMAC instead of predictable UUID
  const tempPass = createHmac("sha256", process.env.SESSION_SECRET || "fallback-dev-secret")
    .update(userId)
    .digest("hex")
    .slice(0, 32);

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    email: tempEmail,
    email_confirm: true,
    password: tempPass,
  });

  if (updateErr) {
    req.log.error({ err: updateErr }, "[OTP Verify] updateUser for session failed");
    res.status(500).json({ error: "Session creation failed", detail: updateErr.message });
    return;
  }

  const anonClient = getSupabase();
  const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: tempEmail,
    password: tempPass,
  });

  if (signInErr || !signInData.session) {
    req.log.error({ err: signInErr }, "[OTP Verify] signInWithPassword failed");
    res.status(500).json({ error: "Session creation failed", detail: signInErr?.message });
    return;
  }

  res.json({
    success: true,
    isNew,
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
  });
});

// ─── Sign Out ─────────────────────────────────────────────────────────────────
router.post("/auth/signout", (_req, res) => {
  return res.json({ success: true });
});

export default router;
