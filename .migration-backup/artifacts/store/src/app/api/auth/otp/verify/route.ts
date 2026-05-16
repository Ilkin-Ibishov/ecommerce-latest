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

    const supabase = await createAdminClient();

    // Check if user exists by phone
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users.find(
      (u) => u.phone === phone || u.user_metadata?.phone === phone
    );

    let authUser;
    let isNew = false;

    if (existingUser) {
      authUser = existingUser;
    } else {
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        phone,
        phone_confirm: true,
        user_metadata: { phone },
        email: `${phone.replace("+", "")}@phone.local`,
        email_confirm: true,
      });

      if (error || !newUser.user) {
        return NextResponse.json(
          { error: "Failed to create user" },
          { status: 500 }
        );
      }

      authUser = newUser.user;
      isNew = true;

      await (supabase as any).from("users").upsert({
        id: authUser.id,
        phone,
        role: "customer",
      });
    }

    // Create a server-side session via admin API
    const { data: session, error: sessionError } =
      await (supabase.auth.admin as any).createSession({
        user_id: authUser.id,
      });

    if (sessionError || !session) {
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
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
