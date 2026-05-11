import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, createOTP, validateAzPhone } from "@/lib/auth/otp";
import { sendWhatsAppOTP } from "@/lib/whatsapp/client";

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    if (!validateAzPhone(phone)) {
      return NextResponse.json(
        { error: "Invalid Azerbaijan phone number format" },
        { status: 400 }
      );
    }

    const rateCheck = await checkRateLimit(phone);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", reason: rateCheck.reason },
        { status: 429 }
      );
    }

    const code = await createOTP(phone);
    await sendWhatsAppOTP(phone, code);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[OTP Request] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
