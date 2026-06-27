-- SEC-003 (P1) — Drop the public/anon read policy on public.coupons.
--
-- Spec:    .kiro/specs/supabase-rls-security-fixes (bugfix)
-- Task:    12 — Property 3.
-- Finding: An anon SELECT on public.coupons returned every active coupon's
--          code/discount_value/min_order_amount/max_uses/scope, exposing
--          sensitive marketing data to any visitor. Confirmed live (task 12.4
--          BEFORE): the public-read policy is named "coupons_customer_read"
--          (cmd=SELECT, roles={public}, qual=(is_active = true OR <admin>)) —
--          NOT the design's assumed "Coupons: public read active". The REAL live
--          name is used below.
--
-- Fix:     Remove the broad public read. Coupon validation is server-side only
--          via POST /api/coupons/validate (service role, bypasses RLS), and the
--          admin coupon list is served via GET /admin/coupons (service role,
--          requireAdmin — added in task 12.1, with CouponsPage re-routed in
--          12.2, BEFORE this drop so the admin list never breaks). NO public
--          coupon-read view is introduced.
--
-- Atomic-unit ordering: the admin read path (GET /admin/coupons + CouponsPage
-- re-route) ships together-with-or-before this drop.
--
-- Retained: "coupons_admin_write" (cmd=ALL) — admin full access. Kept as-is.
--
-- Requirements: 2.3, 2.9, 2.10, 3.3, 3.9

drop policy if exists "coupons_customer_read" on public.coupons;

-- RETAINED (do NOT drop): "coupons_admin_write" ON public.coupons FOR ALL
-- No public coupon-read view introduced.
