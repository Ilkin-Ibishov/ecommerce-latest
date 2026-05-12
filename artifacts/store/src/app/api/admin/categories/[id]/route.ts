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

  await (admin as any).from("categories").update({
    slug: body.slug,
    icon_url: body.icon_url ?? null,
    parent_id: body.parent_id ?? null,
  }).eq("id", id);

  await (admin as any).from("category_translations").delete().eq("category_id", id);
  if (body.translations?.length) {
    await (admin as any).from("category_translations").insert(
      body.translations.map((t: any) => ({ ...t, category_id: id }))
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = await createAdminClient();
  await (admin as any).from("categories").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
