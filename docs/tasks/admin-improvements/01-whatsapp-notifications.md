# Task 01 — WhatsApp Notifications: Env Vars + Retry Endpoint

**Priority:** P0  
**Effort:** ~1h (reduced from 2h — templates are already done)  
**Blocks:** WhatsApp notifications fail silently without the env vars in Vercel.

---

## What's Already Done (do NOT rewrite)

After reading the actual source files, the following is already fully implemented:

- `whatsapp.ts` — `sendWhatsAppOrderConfirmed` and `sendWhatsAppStatusUpdate` both exist with **complete Azerbaijani text** for all statuses (`phone_verified`, `courier_assigned`, `shipped`, `delivered`, `refused_at_delivery`, `cancelled`)
- `notifications.ts` — calls those functions, records success/failure to the `notifications` table
- `admin.ts` — `GET /admin/orders/:id/notifications` and `POST /admin/whatsapp/test` exist and work
- `OrderDetailPage.tsx` — WhatsApp notification log + test sender UI already wired

The original plan to write Azerbaijani templates was **wrong** — they exist.

---

## What Actually Needs Doing

### Step 1 — Set Vercel Environment Variables (REQUIRED)

Without these, `sendMessage()` in `whatsapp.ts` falls into the mock path (`console.log` only):

```typescript
if (!ULTRAMSG_INSTANCE || !ULTRAMSG_TOKEN) {
  console.log(`[WhatsApp MOCK] To ${phone}:\n${message}`);
  return { ok: true };
}
```

Add to Vercel project via dashboard or Vercel MCP:

| Variable | Value |
|----------|-------|
| `ULTRAMSG_INSTANCE` | `instance176989` |
| `ULTRAMSG_TOKEN` | `t6grha7wofb8amif` |

After adding, redeploy is triggered automatically.

### Step 2 — Add Retry Endpoint

**File:** `artifacts/api-server/src/routes/admin.ts`

Add after the existing `GET /admin/orders/:id/notifications`:

```typescript
router.post("/admin/notifications/:id/retry", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { data: notif } = await (ctx.admin as any)
    .from("notifications")
    .select("*")
    .eq("id", rawId)
    .single();

  if (!notif) { res.status(404).json({ error: "Not found" }); return; }

  // Re-queue using existing infrastructure
  await queueNotification({
    userId: notif.user_id ?? undefined,
    type: notif.type,
    recipient: notif.recipient,
    payload: notif.payload,
  });

  res.json({ success: true });
});
```

No ordering conflict — this is a 4-segment path, not affected by `:id` routes.

### Step 3 — Add Retry Button to `OrderDetailPage.tsx`

In the notification log section, add a "Retry" button next to failed entries:

```tsx
{n.status === "failed" && (
  <button
    onClick={async () => {
      await adminFetch(apiUrl(`/admin/notifications/${n.id}/retry`), { method: "POST" });
      // Refresh notification list
      setSaved((v) => !v); // triggers the useEffect that reloads notifications
    }}
    className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition"
  >
    Retry
  </button>
)}
```

---

## Smoke Test After Env Vars Are Set

1. Check `/admin/orders/:id` → WhatsApp section → "Göndər" test button
2. Use your real phone number
3. Should receive: `"🔧 İlk Electronics — WhatsApp test mesajı..."`
4. If it works, place a test order and confirm the order confirmation arrives

---

## Files Changed
- Vercel env vars (via dashboard or MCP — no code change needed)
- `artifacts/api-server/src/routes/admin.ts` — retry endpoint
- `artifacts/store/src/pages/admin/OrderDetailPage.tsx` — retry button

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
