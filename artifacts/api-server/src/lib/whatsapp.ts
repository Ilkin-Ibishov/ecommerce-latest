/**
 * WhatsApp messaging via UltraMsg (https://ultramsg.com)
 * Free tier: 1,000 messages/day · no server required · 5-min setup
 *
 * Required env vars:
 *   ULTRAMSG_INSTANCE  — Instance ID shown on the UltraMsg dashboard (e.g. "instance123456")
 *   ULTRAMSG_TOKEN     — API token shown on the UltraMsg dashboard
 */

const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE ?? "";
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN ?? "";
const STORE_NAME = process.env.VITE_STORE_NAME ?? "ILK Electronics";
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? "+994556195907";

async function sendMessage(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!ULTRAMSG_INSTANCE || !ULTRAMSG_TOKEN) {
    console.log(`[WhatsApp MOCK] To ${phone}:\n${message}`);
    return { ok: true };
  }

  try {
    // UltraMsg expects the phone in international format without leading +
    const to = phone.replace(/^\+/, "").replace(/\D/g, "");

    const response = await fetch(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}/messages/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: ULTRAMSG_TOKEN,
          to: `+${to}`,
          body: message,
        }),
      },
    );

    const data = await response.json() as any;

    if (!response.ok || data?.sent === "false" || data?.error) {
      const errMsg = data?.error ?? `HTTP ${response.status}`;
      console.error(`[WhatsApp] Send failed: ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (err: any) {
    console.error("[WhatsApp] Error:", err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

export async function sendWhatsAppOTP(phone: string, code: string): Promise<void> {
  const message =
    `${STORE_NAME}: Doğrulama kodunuz *${code}*. ` +
    `10 dəqiqə ərzində etibarlıdır. Heç kimlə paylaşmayın.`;
  await sendMessage(phone, message);
}

export async function sendWhatsAppOrderConfirmed(
  phone: string,
  orderId: string,
  itemCount: number,
  totalAzn: number,
): Promise<{ ok: boolean; error?: string }> {
  const shortId = orderId.slice(0, 8).toUpperCase();
  const message =
    `✅ ${STORE_NAME}\n\n` +
    `Sifariş #${shortId} qəbul edildi!\n` +
    `📦 ${itemCount} məhsul · ${totalAzn.toFixed(2)} ₼\n` +
    `💵 Ödəniş: Çatdırılmada nağd\n\n` +
    `Sualınız üçün: ${ADMIN_PHONE}`;
  return sendMessage(phone, message);
}

export async function sendWhatsAppStatusUpdate(
  phone: string,
  orderId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const shortId = orderId.slice(0, 8).toUpperCase();

  const statusMessages: Record<string, string> = {
    phone_verified:
      `📋 ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Sifarişiniz təsdiqləndi və hazırlanmağa başlandı.`,
    courier_assigned:
      `🚴 ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Kuryerimiz sifarişinizi götürdü. Tezliklə çatdırılacaq!`,
    shipped:
      `🚚 ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Sifarişiniz yola düşdü! Kuryerimiz sizə çatdıracaq.`,
    delivered:
      `🎉 ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Sifarişiniz çatdırıldı. ${STORE_NAME}-i seçdiyiniz üçün təşəkkür edirik!`,
    refused_at_delivery:
      `↩️ ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Sifarişiniz qəbul edilmədi və geri qaytarıldı.\n` +
      `Ətraflı məlumat üçün: ${ADMIN_PHONE}`,
    cancelled:
      `❌ ${STORE_NAME} — Sifariş #${shortId}\n\n` +
      `Sifarişiniz ləğv edildi.\n` +
      `Sualınız varsa: ${ADMIN_PHONE}`,
  };

  const message = statusMessages[status];
  if (!message) return { ok: true };
  return sendMessage(phone, message);
}

export async function sendWhatsAppTestMessage(phone: string): Promise<{ ok: boolean; error?: string }> {
  const message =
    `🔧 ${STORE_NAME} — WhatsApp test mesajı\n\n` +
    `Bu mesaj admin panelindən göndərildi. Əlaqə işləyir! ✅`;
  return sendMessage(phone, message);
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(ULTRAMSG_INSTANCE && ULTRAMSG_TOKEN);
}

export function getWhatsAppInstance(): string {
  return ULTRAMSG_INSTANCE || "(not configured)";
}
