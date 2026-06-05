# WhatsApp Order Notifications — Task #7

## Current state (accurate as of May 2026)

The integration skeleton is **fully wired** already:
- `whatsapp.ts` — Evolution API client, gracefully mocks when env vars unset
- `notifications.ts` — `queueNotification()` logs to DB + calls `sendWhatsAppStatusUpdate`
- `orders.ts` — triggers `queueNotification` on order creation ✅
- `auth.ts` — calls `sendWhatsAppOTP` on OTP request ✅
- `admin.ts` — triggers `queueNotification` on status change ✅
- `notifications` table — defined in schema.sql ✅

**What's actually missing / broken:**
1. All 3 Evolution API env vars (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`) are unset → every message is a no-op console log
2. All message templates are in English — must be Azerbaijani (primary) / Russian (fallback)
3. Order confirmation message has no order detail — missing total ₼, item count, COD reminder, store phone
4. OTP message is in English — "Your verification code is X. Do not share it."
5. Admin Order Detail page has no notification delivery status display
6. No admin test endpoint to verify WhatsApp connection without placing a real order

## Done looks like
- Customer receives an Azerbaijani WhatsApp message immediately after placing an order
- Customer receives Azerbaijani status-change messages as admin updates the order
- OTP codes are sent in Azerbaijani
- Admin can see notification delivery status (sent/failed) in Order Detail
- Admin has a test endpoint to ping WhatsApp connection
- Failures are logged but don't block order flow

## Implementation steps

### Step 1 — Azerbaijani message templates in `whatsapp.ts`
Rewrite all templates in Azerbaijani. Status map:
- `confirmed` (order placed): "ILK Electronics — Sifariş #XXXX qəbul edildi. Məbləğ: X.XX ₼ (X məhsul). Çatdırılmada ödəniş. Sualınız üçün: +994556195907"
- `phone_verified`: "Sifarişiniz təsdiqləndi və hazırlanmağa başlandı."
- `courier_assigned`: "Kuryerimiz sifarişinizi götürdü. Tezliklə çatdırılacaq."
- `shipped`: "Sifarişiniz yola düşdü! Kuryerimiz sizə çatdıracaq."
- `delivered`: "Sifarişiniz çatdırıldı. ILK Electronics-i seçdiyiniz üçün təşəkkür edirik! 🎉"
- `refused_at_delivery`: "Sifarişiniz geri qaytarıldı. Ətraflı məlumat üçün: +994556195907"
- `cancelled`: "Sifarişiniz ləğv edildi. Sualınız varsa: +994556195907"

OTP template: "ILK Electronics: Doğrulama kodunuz *XXXX*. 10 dəqiqə ərzində etibarlıdır. Heç kimlə paylaşmayın."

### Step 2 — Enrich order confirmation payload
In `orders.ts`, pass `item_count` and `total` in the payload so the confirmed template can show "3 məhsul · 245.00 ₼".

### Step 3 — Admin test endpoint
`POST /api/admin/whatsapp/test` (admin-only): accepts `{ phone }`, sends a test message, returns `{ ok, error? }`. Also `GET /api/admin/whatsapp/status` returns `{ configured: bool, instance: string }`.

### Step 4 — Notifications log in admin Order Detail
Query `notifications` table where `payload->order_id = :orderId`. Show a small collapsible section "WhatsApp Bildirişləri" with each row: channel badge, status badge (sent/failed/pending), timestamp, recipient.

### Step 5 — Ensure notifications table is migrated in live DB
The table is in schema.sql but may not exist in the live Supabase project. Run migration check on startup; if missing, log a warning (don't crash).

## Relevant files
- `artifacts/api-server/src/lib/whatsapp.ts`
- `artifacts/api-server/src/lib/notifications.ts`
- `artifacts/api-server/src/routes/orders.ts`
- `artifacts/api-server/src/routes/admin.ts`
- `artifacts/store/src/pages/admin/OrderDetailPage.tsx`
- `supabase/schema.sql`

## What the USER must do (env vars)
Provider: **UltraMsg** (ultramsg.com) — free tier, cloud-hosted, no server required.

Setup steps:
1. Go to https://ultramsg.com → Sign up free
2. Create a new instance → scan the QR code with your WhatsApp number
3. Copy the Instance ID and Token from the dashboard
4. Add two Replit secrets:
   - `ULTRAMSG_INSTANCE` — Instance ID (e.g. `instance123456`)
   - `ULTRAMSG_TOKEN` — API token from the dashboard
5. Restart the API server → messages will start sending immediately
6. Verify with the test sender in any Order Detail page
