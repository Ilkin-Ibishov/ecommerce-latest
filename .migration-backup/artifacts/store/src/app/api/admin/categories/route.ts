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

  const { data: cat, error } = await (admin as any)
    .from("categories")
    .insert({ slug: body.slug, icon_url: body.icon_url ?? null, parent_id: body.parent_id ?? null })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.translations?.length) {
    await (admin as any).from("category_translations").insert(
      body.translations.map((t: any) => ({ ...t, category_id: (cat as any).id }))
    );
  }

  return NextResponse.json({ success: true, id: (cat as any).id });
}
