import { getAdminSupabase } from "./supabase";
import { sendWhatsAppStatusUpdate } from "./whatsapp";

type NotifType =
  | "order_confirmed"
  | "status_changed"
  | "low_stock";

export async function queueNotification(params: {
  userId?: string;
  type: NotifType;
  recipient: string;
  payload: Record<string, any>;
}): Promise<void> {
  const { userId, type, recipient, payload } = params;
  const admin = getAdminSupabase();

  let notifId: string | null = null;
  try {
    const { data } = await (admin as any)
      .from("notifications")
      .insert({
        user_id: userId ?? null,
        type,
        channel: "whatsapp",
        recipient,
        payload,
        status: "pending",
        attempts: 0,
      })
      .select("id")
      .single();
    notifId = data?.id ?? null;
  } catch {
  }

  try {
    if (type === "order_confirmed" || type === "status_changed") {
      await sendWhatsAppStatusUpdate(recipient, payload.order_id, payload.status ?? "confirmed");
    }
    if (notifId) {
      await (admin as any)
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1, last_attempt_at: new Date().toISOString() })
        .eq("id", notifId);
    }
  } catch {
    if (notifId) {
      await (admin as any)
        .from("notifications")
        .update({ status: "retrying", attempts: 1, last_attempt_at: new Date().toISOString() })
        .eq("id", notifId);
    }
  }
}
