# Task 01 — WhatsApp Notifications: Env Vars + Azerbaijani Templates

**Priority:** P0  
**Effort:** ~2h  
**Blocks:** Every WhatsApp notification in production is broken until this is done.

---

## Problem

The WhatsApp integration skeleton is wired end-to-end but two things prevent it from working in production:

1. `ULTRAMSG_INSTANCE` and `ULTRAMSG_TOKEN` are not set as Vercel environment variables.
2. `whatsapp.ts` sends generic/English placeholder text instead of real Azerbaijani messages.

Current behavior: every WhatsApp notification silently fails with a connection error.

---

## Step 1 — Set Vercel Environment Variables

Go to the Vercel project settings and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `ULTRAMSG_INSTANCE` | `instance176989` | UltraMsg instance ID (already in local `.env`) |
| `ULTRAMSG_TOKEN` | `t6grha7wofb8amif` | UltraMsg API token (already in local `.env`) |

**Via Vercel MCP (once Kiro has access):**
```
mcp_vercel_set_variables({ 
  variables: { 
    ULTRAMSG_INSTANCE: "instance176989",
    ULTRAMSG_TOKEN: "t6grha7wofb8amif"
  }
})
```

**Or manually:** Vercel Dashboard → Project → Settings → Environment Variables → Add.

---

## Step 2 — Write Azerbaijani Message Templates

**File:** `artifacts/api-server/src/lib/whatsapp.ts`

Replace placeholder message bodies with proper Azerbaijani text for each notification type:

### `order_confirmed` template
```
Salam {customer_name}! 🛍️

Sifarişiniz qəbul edildi.
Sifariş nömrəsi: #{order_id_short}
Məbləğ: {total} AZN
Məhsul sayı: {item_count}

Kuryer sizinlə əlaqə saxlayacaq. Ödəniş çatdırılmada.

İlk Electronics 📦
```

### `status_changed` templates (per status)

| Status | Azerbaijani message |
|--------|-------------------|
| `phone_verified` | `Sifarişiniz #{id} təsdiqləndi! Kuryer tezliklə sizinlə əlaqə saxlayacaq.` |
| `courier_assigned` | `Sifarişiniz #{id} üçün kuryer təyin edildi. Tezliklə çatdırılacaq!` |
| `shipped` | `Sifarişiniz #{id} yoldadır! Kuryer sizinlə əlaqə saxlayacaq.` |
| `delivered` | `Sifarişiniz #{id} çatdırıldı. Alış-verişiniz üçün təşəkkür edirik! 🎉` |
| `refused_at_delivery` | `Sifarişiniz #{id} qəbul edilmədi. Ətraflı məlumat üçün bizimlə əlaqə saxlayın.` |
| `cancelled` | `Sifarişiniz #{id} ləğv edildi. Sualınız varsa bizimlə əlaqə saxlayın.` |

### `low_stock` template (future)
```
Stok xəbərdarlığı: "{product_name}" məhsulunda {stock} ədəd qalıb.
```

---

## Step 3 — Add Status-Change Message Routing

**File:** `artifacts/api-server/src/lib/whatsapp.ts`

Currently `sendWhatsAppOTP` exists, but `sendOrderStatusNotification` may only send generic text.

Ensure the function reads `payload.status` and picks the correct template from Step 2.

```typescript
export async function sendOrderStatusNotification(
  phone: string,
  orderId: string,
  status: string,
  customerName: string,
): Promise<{ ok: boolean; error?: string }> {
  const shortId = orderId.slice(0, 8).toUpperCase();
  const templates: Record<string, string> = {
    phone_verified: `Sifarişiniz #${shortId} təsdiqləndi! Kuryer tezliklə sizinlə əlaqə saxlayacaq.`,
    courier_assigned: `Sifarişiniz #${shortId} üçün kuryer təyin edildi.`,
    shipped: `Sifarişiniz #${shortId} yoldadır!`,
    delivered: `Salam ${customerName}! Sifarişiniz #${shortId} çatdırıldı. Təşəkkür edirik! 🎉`,
    refused_at_delivery: `Sifarişiniz #${shortId} qəbul edilmədi. Bizimlə əlaqə saxlayın.`,
    cancelled: `Sifarişiniz #${shortId} ləğv edildi.`,
  };
  const message = templates[status];
  if (!message) return { ok: true }; // no message for this status
  return sendWhatsAppMessage(phone, message);
}
```

---

## Step 4 — Add Failed Notification Retry Endpoint

**File:** `artifacts/api-server/src/routes/admin.ts`

Add a route so admins can retry a failed notification from the UI:

```typescript
router.post("/admin/notifications/:id/retry", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }
  
  const { data: notif } = await (ctx.admin as any)
    .from("notifications")
    .select("*")
    .eq("id", req.params.id)
    .single();
  
  if (!notif) { res.status(404).json({ error: "Not found" }); return; }
  
  // Re-queue
  await queueNotification({
    type: notif.type,
    recipient: notif.recipient,
    payload: notif.payload,
  });
  
  res.json({ success: true });
});
```

**Frontend:** `OrderDetailPage.tsx` — add a "Retry" button next to each failed notification in the notification log panel.

---

## Step 5 — Smoke Test

After deploying:
1. Place a test order using a real phone number
2. Check the notification log in `/admin/orders/:id` — status should be `sent`
3. Update the order status and verify the WhatsApp message arrives

---

## Files Changed
- `artifacts/api-server/src/lib/whatsapp.ts` — Azerbaijani templates
- `artifacts/api-server/src/routes/admin.ts` — retry endpoint
- `artifacts/store/src/pages/admin/OrderDetailPage.tsx` — retry button in notification log
- Vercel env vars (via dashboard or MCP)
