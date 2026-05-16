import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
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
        const found = allUsers?.find((u) => u.phone === phone);
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

    // 3. Issue a session via the GoTrue admin REST endpoint
    //    POST /auth/v1/admin/users/{id}/token  (available in modern GoTrue / Supabase)
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const tokenRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/token`, {
      method: "POST",
      headers: {
        "apikey": serviceKey!,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      req.log.error({ status: tokenRes.status, body: errText }, "[OTP Verify] Token endpoint failed");
      return res.status(500).json({ error: "Session creation failed", detail: errText });
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };

    return res.json({
      success: true,
      isNew,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
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
