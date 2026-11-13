import { getAdminSupabase } from "./supabase";
import {
  sendWhatsAppOrderConfirmed,
  sendWhatsAppStatusUpdate,
} from "./whatsapp";

type NotifType =
  | "order_confirmed"
  | "status_changed"
  | "low_stock";

type NotifChannel = "whatsapp" | "in_app";

export async function queueNotification(params: {
  userId?: string;
  type: NotifType;
  channel?: NotifChannel;
  recipient?: string;
  payload: Record<string, any>;
}): Promise<void> {
  const { userId, type, payload } = params;
  const channel = params.channel ?? (type === "low_stock" ? "in_app" : "whatsapp");
  const recipient = params.recipient || (channel === "in_app" ? "admin" : "");
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
      result = await sendWhatsAppStatusUpdate(recipient, payload.order_id, payload.status ?? "");
    } else if (type === "low_stock") {
      // In-app digest notification (Phase M4 spec §6.4)
      result = { ok: true };
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
