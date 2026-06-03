import { Router } from "express";
import { randomInt } from "crypto";
import { devInjectOTP, devGetLastOTP, validateAzPhone } from "../lib/otp";

const router = Router();

// ─── Dev/Test only routes ──────────────────────────────────────────────────────
// These endpoints are ONLY registered when NODE_ENV !== 'production'.
// They allow the test suite to drive OTP auth without WhatsApp.

// POST /dev/mock-otp
// Body: { phone: string }
// Response: { code: string }  — the 6-digit OTP code ready to be verified
router.post("/dev/mock-otp", (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || !validateAzPhone(phone)) {
    return res.status(400).json({ error: "Valid Azerbaijan phone required (+994XXXXXXXXX)" });
  }
  const code = String(randomInt(100000, 999999));
  devInjectOTP(phone, code);
  console.log(`[DEV mock-otp] ${phone} → ${code}`);
  return res.json({ code, phone });
});

// GET /dev/last-otp?phone=+994XXXXXXXXX
// Returns the plaintext OTP code last generated for a phone number.
// Used by the test suite to retrieve the code after clicking "Send Code" in the UI.
router.get("/dev/last-otp", (req, res) => {
  const { phone } = req.query as { phone?: string };
  if (!phone || !validateAzPhone(phone)) {
    return res.status(400).json({ error: "Valid Azerbaijan phone required (+994XXXXXXXXX)" });
  }
  const code = devGetLastOTP(phone);
  if (!code) {
    return res.status(404).json({ error: "No active OTP found for this phone" });
  }
  return res.json({ code, phone });
});

export default router;
