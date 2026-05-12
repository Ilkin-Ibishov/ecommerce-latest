import { createAdminClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import CouponManager from "@/components/admin/coupon-manager";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  const admin = await createAdminClient();
  const { data: rawCoupons } = await (admin as any)
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  const coupons = (rawCoupons ?? []) as any[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Coupons</h1>
      <CouponManager initialCoupons={coupons} />
    </div>
  );
}
