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

  const { data: product, error } = await (admin as any)
    .from("products")
    .insert({
      slug: body.slug,
      price: body.price,
      stock: body.stock,
      is_featured: body.is_featured ?? false,
      is_on_sale: body.is_on_sale ?? false,
      is_deal_of_day: body.is_deal_of_day ?? false,
      sort_order: body.sort_order ?? 0,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const productId = (product as any).id;

  if (body.translations?.length) {
    await (admin as any).from("product_translations").insert(
      body.translations.map((t: any) => ({ ...t, product_id: productId }))
    );
  }

  if (body.images?.length) {
    await (admin as any).from("product_images").insert(
      body.images.map((img: any, i: number) => ({
        product_id: productId,
        url: img.url,
        alt_text: img.alt_text ?? null,
        sort_order: i,
      }))
    );
  }

  if (body.category_ids?.length) {
    await (admin as any).from("product_categories").insert(
      body.category_ids.map((cat_id: string) => ({ product_id: productId, category_id: cat_id }))
    );
  }

  await (admin as any).from("audit_log").insert({
    actor_id: user.id,
    action: "create_product",
    entity: "product",
    entity_id: productId,
    changes: body,
  });

  return NextResponse.json({ success: true, id: productId });
}
