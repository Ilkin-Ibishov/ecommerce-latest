import { createAdminClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import OrderStatusForm from "@/components/admin/order-status-form";

export const metadata: Metadata = { title: "Order Detail" };

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await createAdminClient();

  const { data: rawOrder } = await (admin as any)
    .from("orders")
    .select("*, order_items(*, products(slug, product_translations(lang_code,title))), coupons(code)")
    .eq("id", id)
    .single();

  if (!rawOrder) notFound();
  const order = rawOrder as any;

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    phone_verified: "bg-blue-500/20 text-blue-400",
    courier_assigned: "bg-purple-500/20 text-purple-400",
    shipped: "bg-indigo-500/20 text-indigo-400",
    delivered: "bg-green-500/20 text-green-400",
    refused_at_delivery: "bg-red-500/20 text-red-400",
    cancelled: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground text-sm transition">
          ← Orders
        </Link>
        <h1 className="text-xl font-bold">Order #{id.slice(0, 8).toUpperCase()}</h1>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"}`}>
          {String(order.status).replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">Customer</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Name:</span> {order.customer_name}</p>
            <p><span className="text-muted-foreground">Phone:</span> {order.customer_phone}</p>
            <p><span className="text-muted-foreground">Address:</span> {order.delivery_address}</p>
            {order.notes && <p><span className="text-muted-foreground">Notes:</span> {order.notes}</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">Financials</h2>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Subtotal:</span> {(order.total_azn + order.discount_azn).toFixed(2)} AZN</p>
            {order.discount_azn > 0 && (
              <p className="text-green-400">
                <span className="text-muted-foreground">Discount:</span> -{order.discount_azn.toFixed(2)} AZN
                {order.coupons?.code && ` (${order.coupons.code})`}
              </p>
            )}
            <p className="font-bold text-lg mt-2">Total: {order.total_azn.toFixed(2)} AZN</p>
            <p className="text-muted-foreground text-xs">Cash on delivery</p>
          </div>
          <div className="pt-2 text-xs text-muted-foreground">
            Placed: {new Date(order.created_at).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Order items */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-semibold">Items</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-5 py-3 font-medium">Product</th>
              <th className="text-right px-5 py-3 font-medium">Unit Price</th>
              <th className="text-right px-5 py-3 font-medium">Qty</th>
              <th className="text-right px-5 py-3 font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.order_items as any[]).map((item: any) => (
              <tr key={item.id} className="border-b border-border/50">
                <td className="px-5 py-3">{item.product_title_snapshot}</td>
                <td className="px-5 py-3 text-right">{Number(item.product_price_snapshot).toFixed(2)} AZN</td>
                <td className="px-5 py-3 text-right">{item.quantity}</td>
                <td className="px-5 py-3 text-right font-medium">{Number(item.line_total).toFixed(2)} AZN</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status update */}
      <OrderStatusForm orderId={id} currentStatus={order.status} />
    </div>
  );
}
