import { getAdminSupabase } from "./supabase";
import {
  sendWhatsAppDeliveryFeeSet,
  sendWhatsAppOrderConfirmed,
  sendWhatsAppStatusUpdate,
} from "./whatsapp";

type NotifType =
  | "order_confirmed"
  | "status_changed"
  | "delivery_fee_set";

type NotifChannel = "whatsapp";

export async function queueNotification(params: {
  userId?: string;
  type: NotifType;
  channel?: NotifChannel;
  recipient?: string;
  payload: Record<string, any>;
}): Promise<void> {
  const { userId, type, payload } = params;
  const channel = params.channel ?? "whatsapp";
  const recipient = params.recipient || "";
  const admin = getAdminSupabase();

  let notifId: string | null = null;
  try {
    const { data } = await (admin as any)
      .from("notifications")
      .insert({
        user_id: userId ?? null,
        type,
        channel,
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

  let result: { ok: boolean; error?: string } = { ok: false, error: "unhandled type" };

  try {
    if (type === "order_confirmed") {
      result = await sendWhatsAppOrderConfirmed(
        recipient,
        payload.order_id,
        payload.item_count ?? 1,
        Number(payload.total ?? 0),
      );
    } else if (type === "status_changed") {
      result = await sendWhatsAppStatusUpdate(
        recipient,
        payload.order_id,
        payload.status ?? "",
        payload.delivery_fee,
        payload.total !== undefined ? Number(payload.total) : undefined,
      );
    } else if (type === "delivery_fee_set") {
      result = await sendWhatsAppDeliveryFeeSet(
        recipient,
        payload.order_id,
        Number(payload.delivery_fee ?? 0),
        Number(payload.total ?? 0),
      );
    }

    if (notifId) {
      if (result.ok) {
        await (admin as any)
          .from("notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: 1,
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", notifId);
      } else {
        await (admin as any)
          .from("notifications")
          .update({
            status: "failed",
            attempts: 1,
            last_attempt_at: new Date().toISOString(),
            error_message: result.error ?? "unknown",
          })
          .eq("id", notifId);
      }
    }
  } catch (err: any) {
    if (notifId) {
      await (admin as any)
        .from("notifications")
        .update({
          status: "failed",
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
          error_message: err?.message ?? "exception",
        })
        .eq("id", notifId);
    }
  }
}
