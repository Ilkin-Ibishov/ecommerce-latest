import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendWhatsAppStatusUpdate } from "@/lib/whatsapp/client";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await (supabase as any).from("users").select("role").eq("id", user.id).single();
  if ((profile as any)?.role !== "admin") return null;
  return user;
}

const VALID_STATUSES = [
  "pending",
  "phone_verified",
  "courier_assigned",
  "shipped",
  "delivered",
  "refused_at_delivery",
  "cancelled",
];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { status } = await request.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = await createAdminClient();
  const { data: order } = await (admin as any)
    .from("orders")
    .update({ status })
    .eq("id", id)
    .select("customer_phone, customer_name")
    .single();

  if (order) {
    await sendWhatsAppStatusUpdate((order as any).customer_phone, id, status);
  }

  await (admin as any).from("audit_log").insert({
    actor_id: user.id,
    action: "update_order_status",
    entity: "order",
    entity_id: id,
    changes: { status },
  });

  return NextResponse.json({ success: true });
}
