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

  await (admin as any).from("products").update({
    slug: body.slug,
    price: body.price,
    stock: body.stock,
    is_featured: body.is_featured,
    is_on_sale: body.is_on_sale,
    is_deal_of_day: body.is_deal_of_day,
    sort_order: body.sort_order ?? 0,
  }).eq("id", id);

  await (admin as any).from("product_translations").delete().eq("product_id", id);
  if (body.translations?.length) {
    await (admin as any).from("product_translations").insert(
      body.translations.map((t: any) => ({ ...t, product_id: id }))
    );
  }

  await (admin as any).from("product_images").delete().eq("product_id", id);
  if (body.images?.length) {
    await (admin as any).from("product_images").insert(
      body.images.map((img: any, i: number) => ({
        product_id: id,
        url: img.url,
        alt_text: img.alt_text ?? null,
        sort_order: i,
      }))
    );
  }

  await (admin as any).from("product_categories").delete().eq("product_id", id);
  if (body.category_ids?.length) {
    await (admin as any).from("product_categories").insert(
      body.category_ids.map((cat_id: string) => ({ product_id: id, category_id: cat_id }))
    );
  }

  await (admin as any).from("audit_log").insert({
    actor_id: user.id,
    action: "update_product",
    entity: "product",
    entity_id: id,
    changes: body,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = await createAdminClient();

  await (admin as any).from("products").delete().eq("id", id);

  await (admin as any).from("audit_log").insert({
    actor_id: user.id,
    action: "delete_product",
    entity: "product",
    entity_id: id,
    changes: null,
  });

  return NextResponse.json({ success: true });
}
