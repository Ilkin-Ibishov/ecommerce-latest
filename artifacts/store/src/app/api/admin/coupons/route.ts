import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await (supabase as any).from("users").select("role").eq("id", user.id).single();
  if ((profile as any)?.role !== "admin") return null;
  return user;
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const admin = await createAdminClient();

  const { data, error } = await (admin as any).from("coupons").insert({
    code: body.code.toUpperCase().trim(),
    description: body.description ?? null,
    discount_type: body.discount_type,
    discount_value: body.discount_value,
    min_order_amount: body.min_order_amount ?? null,
    max_uses: body.max_uses ?? null,
    max_uses_per_user: body.max_uses_per_user ?? null,
    starts_at: body.starts_at ?? null,
    expires_at: body.expires_at ?? null,
    is_active: body.is_active ?? true,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: (data as any).id });
}
