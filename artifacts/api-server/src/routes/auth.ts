import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { validateAzPhone, checkRateLimit, createOTP, verifyOTP } from "../lib/otp";
import { sendWhatsAppOTP } from "../lib/whatsapp";

const router = Router();

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

router.post("/auth/otp/verify", async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: "Phone and code are required" });
    }
    const result = await verifyOTP(phone, code);
    if (!result.valid) {
      return res.status(400).json({ error: "Verification failed", reason: result.reason });
    }

    const admin = getAdminSupabase();
    const { data: existingUser } = await (admin as any)
      .from("users")
      .select("id, full_name, role")
      .eq("phone", phone)
      .maybeSingle();

    let userId: string;
    let isNew = false;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const signUpResult = await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
      });
      if (signUpResult.error) {
        const { data: fetched } = await (admin as any)
          .from("users").select("id").eq("phone", phone).maybeSingle();
        if (!fetched) throw signUpResult.error;
        userId = fetched.id;
      } else {
        userId = signUpResult.data.user.id;
        await (admin as any).from("users").upsert({ id: userId, phone, role: "customer" });
        isNew = true;
      }
    }

    const { data: session } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: `${userId}@whatsapp.placeholder`,
    }).catch(() => ({ data: null }));

    const signInResult = await admin.auth.admin.createSession(userId);
    if (signInResult.error) throw signInResult.error;

    return res.json({
      success: true,
      isNew,
      access_token: signInResult.data.session?.access_token,
      refresh_token: signInResult.data.session?.refresh_token,
    });
  } catch (err) {
    req.log.error(err, "[OTP Verify] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/signout", (req, res) => {
  return res.json({ success: true });
});

export default router;
