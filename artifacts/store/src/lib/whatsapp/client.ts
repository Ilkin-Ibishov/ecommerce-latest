const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME;

const isConfigured =
  EVOLUTION_API_URL &&
  EVOLUTION_API_KEY &&
  INSTANCE &&
  !EVOLUTION_API_URL.includes("placeholder");

export async function sendWhatsAppOTP(
  phone: string,
  code: string
): Promise<void> {
  if (!isConfigured) {
    // Development fallback — log OTP to server console
    console.log(
      `[DEV MODE - WhatsApp OTP] Phone: ${phone} | Code: ${code} | ` +
        `(Evolution API not configured — set EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME)`
    );
    return;
  }

  const response = await fetch(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE}`,
    {
      method: "POST",
      headers: {
        apikey: EVOLUTION_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: phone,
        text:
          `Təsdiq kodunuz: *${code}*\n\n` +
          `Your verification code: *${code}*\n\n` +
          `Bu kodu heç kimlə paylaşmayın. Kod 3 dəqiqə ərzində etibarlıdır.\n` +
          `Do not share this code. Expires in 3 minutes.`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${body}`);
  }
}

export async function sendWhatsAppOrderConfirmation(
  phone: string,
  orderId: string,
  total: number
): Promise<void> {
  if (!isConfigured) {
    console.log(
      `[DEV MODE - WhatsApp] Order confirmed: #${orderId} | Total: ${total} AZN | Phone: ${phone}`
    );
    return;
  }

  const shortId = orderId.slice(0, 8).toUpperCase();
  const response = await fetch(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE}`,
    {
      method: "POST",
      headers: {
        apikey: EVOLUTION_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: phone,
        text:
          `✅ Sifarişiniz #${shortId} təsdiqləndi.\n` +
          `Cəmi: ${total.toFixed(2)} AZN. Çatdırılmada ödəniş.\n\n` +
          `Order #${shortId} confirmed. Total: ${total.toFixed(2)} AZN. Pay on delivery.`,
      }),
    }
  );

  if (!response.ok) {
    console.error(
      `WhatsApp order notification failed: ${response.status} ${await response.text()}`
    );
  }
}

export async function sendWhatsAppStatusUpdate(
  phone: string,
  orderId: string,
  status: string
): Promise<void> {
  if (!isConfigured) {
    console.log(
      `[DEV MODE - WhatsApp] Order #${orderId} status: ${status} | Phone: ${phone}`
    );
    return;
  }

  const shortId = orderId.slice(0, 8).toUpperCase();
  const response = await fetch(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE}`,
    {
      method: "POST",
      headers: {
        apikey: EVOLUTION_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: phone,
        text: `📦 Sifariş #${shortId} statusu yeniləndi: *${status}*`,
      }),
    }
  );

  if (!response.ok) {
    console.error(`WhatsApp status update failed: ${response.status}`);
  }
}
