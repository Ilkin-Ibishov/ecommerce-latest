import { Router } from "express";
import { getAdminSupabase, getSupabase } from "../lib/supabase";
import { validateAzPhone, checkRateLimit, createOTP, verifyOTP } from "../lib/otp";
import { sendWhatsAppOTP } from "../lib/whatsapp";

const router = Router();

// ─── OTP Request ──────────────────────────────────────────────────────────────
router.post("/auth/otp/request", async (req, res) => {
  try {
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
  } catch (err) {
    req.log.error(err, "[OTP Request] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── OTP Verify ───────────────────────────────────────────────────────────────
router.post("/auth/otp/verify", async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: "Phone and code are required" });
    }

    // 1. Verify against our custom OTP table
    const result = await verifyOTP(phone, code);
    if (!result.valid) {
      return res.status(400).json({ error: "Verification failed", reason: result.reason });
    }

    const admin = getAdminSupabase();

    // 2. Find or create the Supabase Auth user
    let userId: string;
    let isNew = false;

    const { data: existingRow } = await (admin as any)
      .from("users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (existingRow) {
      userId = existingRow.id;
    } else {
      // Create the user in Supabase Auth with phone confirmed
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
      });

      if (createErr) {
        // User might already exist in auth but not in public.users
        const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const found = (allUsers as any[])?.find((u: any) => u.phone === phone);
        if (!found) return res.status(500).json({ error: createErr.message });
        userId = found.id;
      } else {
        userId = created.user.id;
        isNew = true;
      }

      // Ensure public.users row exists
      await (admin as any).from("users").upsert({
        id: userId,
        phone,
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
    const tempEmail = `${phone.replace(/[^0-9]/g, "")}@phoneauth.internal`;
    const tempPass  = `pauth_${userId.replace(/-/g, "").slice(0, 24)}`;

    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      email: tempEmail,
      email_confirm: true,
      password: tempPass,
    });

    if (updateErr) {
      req.log.error({ err: updateErr }, "[OTP Verify] updateUser for session failed");
      return res.status(500).json({ error: "Session creation failed", detail: updateErr.message });
    }

    const anonClient = getSupabase();
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: tempEmail,
      password: tempPass,
    });

    if (signInErr || !signInData.session) {
      req.log.error({ err: signInErr }, "[OTP Verify] signInWithPassword failed");
      return res.status(500).json({ error: "Session creation failed", detail: signInErr?.message });
    }

    return res.json({
      success: true,
      isNew,
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    });
  } catch (err) {
    req.log.error(err, "[OTP Verify] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Sign Out ─────────────────────────────────────────────────────────────────
router.post("/auth/signout", (_req, res) => {
  return res.json({ success: true });
});

export default router;
