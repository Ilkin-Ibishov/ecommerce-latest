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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const admin = await createAdminClient();

  await (admin as any).from("coupons").update({
    code: body.code?.toUpperCase().trim(),
    description: body.description ?? null,
    discount_type: body.discount_type,
    discount_value: body.discount_value,
    min_order_amount: body.min_order_amount ?? null,
    max_uses: body.max_uses ?? null,
    max_uses_per_user: body.max_uses_per_user ?? null,
    starts_at: body.starts_at ?? null,
    expires_at: body.expires_at ?? null,
    is_active: body.is_active,
  }).eq("id", id);

  return NextResponse.json({ success: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = await createAdminClient();
  await (admin as any).from("coupons").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
