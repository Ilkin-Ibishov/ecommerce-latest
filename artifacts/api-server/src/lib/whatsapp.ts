const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL ?? "";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? "";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "default";

async function sendMessage(phone: string, message: string): Promise<void> {
  if (!EVOLUTION_API_URL) {
    console.log(`[WhatsApp MOCK] To ${phone}: ${message}`);
    return;
  }
  try {
    const phoneE164 = phone.replace(/\D/g, "");
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: `${phoneE164}@s.whatsapp.net`,
        text: message,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`[WhatsApp] Failed to send: ${response.status} ${body}`);
    }
  } catch (err) {
    console.error("[WhatsApp] Error:", err);
  }
}

export async function sendWhatsAppOTP(phone: string, code: string): Promise<void> {
  const storeName = process.env.VITE_STORE_NAME ?? "Store";
  const message = `${storeName}: Your verification code is *${code}*. Valid for 10 minutes. Do not share it.`;
  await sendMessage(phone, message);
}

export async function sendWhatsAppStatusUpdate(phone: string, orderId: string, status: string): Promise<void> {
  const storeName = process.env.VITE_STORE_NAME ?? "Store";
  const statusMessages: Record<string, string> = {
    phone_verified: "Your order has been confirmed.",
    courier_assigned: "A courier has been assigned to your order.",
    shipped: "Your order is on its way!",
    delivered: "Your order has been delivered. Thank you!",
    refused_at_delivery: "Your order was returned. Please contact us.",
    cancelled: "Your order has been cancelled.",
  };
  const statusMsg = statusMessages[status];
  if (!statusMsg) return;
  const shortId = orderId.slice(0, 8).toUpperCase();
  const message = `${storeName} — Order #${shortId}: ${statusMsg}`;
  await sendMessage(phone, message);
}
