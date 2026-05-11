import { NextRequest, NextResponse } from "next/server";
import { verifyOTP, validateAzPhone } from "@/lib/auth/otp";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { phone, code } = await request.json();

    if (!phone || !code) {
      return NextResponse.json(
        { error: "Phone and code are required" },
        { status: 400 }
      );
    }

    if (!validateAzPhone(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const result = await verifyOTP(phone, code);

    if (!result.success) {
      return NextResponse.json(
        { error: "Verification failed", reason: result.reason },
        { status: 400 }
      );
    }

    // Sign in or create user in Supabase Auth
    const supabase = await createAdminClient();

    // Check if user exists by phone
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users.find(
      (u) => u.phone === phone || u.user_metadata?.phone === phone
    );

    let authUser;
    let isNew = false;

    if (existingUser) {
      // Generate a session for existing user
      const { data: sessionData, error } =
        await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: `${phone.replace("+", "")}@phone.local`,
        });
      authUser = existingUser;
    } else {
      // Create new user
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        phone,
        phone_confirm: true,
        user_metadata: { phone },
        email: `${phone.replace("+", "")}@phone.local`,
        email_confirm: true,
      });

      if (error || !newUser.user) {
        console.error("[OTP Verify] Create user error:", error);
        return NextResponse.json(
          { error: "Failed to create user" },
          { status: 500 }
        );
      }

      authUser = newUser.user;
      isNew = true;

      // Ensure public.users row exists
      await supabase.from("users").upsert({
        id: authUser.id,
        phone,
        role: "customer",
      });
    }

    // Create a session token
    const { data: session, error: sessionError } =
      await supabase.auth.admin.createSession({
        user_id: authUser.id,
      } as any);

    if (sessionError || !session) {
      // Fallback: sign in with password approach won't work, return user info only
      return NextResponse.json({
        success: true,
        isNew,
        userId: authUser.id,
      });
    }

    return NextResponse.json({
      success: true,
      isNew,
      userId: authUser.id,
      access_token: (session as any).access_token,
      refresh_token: (session as any).refresh_token,
    });
  } catch (error) {
    console.error("[OTP Verify] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
