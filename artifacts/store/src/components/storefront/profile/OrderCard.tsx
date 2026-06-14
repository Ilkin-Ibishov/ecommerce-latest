import { useState } from "react";
import { Package, Clock, MapPin, ChevronDown, ChevronUp, Check, ShoppingCart } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { useI18n } from "@/lib/i18n/context";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700" },
  phone_verified: { label: "Confirmed", color: "bg-blue-100 text-blue-700" },
  courier_assigned: { label: "Courier Assigned", color: "bg-indigo-100 text-indigo-700" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700" },
  refused_at_delivery: { label: "Refused", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

const STEPPER_STEPS = [
  { key: "pending", label: "Pending" },
  { key: "phone_verified", label: "Confirmed" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

const STEP_ORDER = ["pending", "phone_verified", "courier_assigned", "shipped", "delivered"];

function StatusStepper({ status }: { status: string }) {
  const isNegative = status === "refused_at_delivery" || status === "cancelled";
  const currentIdx = STEP_ORDER.indexOf(status);

  if (isNegative) {
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_LABELS[status]?.color ?? "bg-gray-100 text-gray-500"}`}>
        {STATUS_LABELS[status]?.label ?? status}
      </span>
    );
  }

  return (
    <div className="flex items-center w-full">
      {STEPPER_STEPS.map((step, idx) => {
        const stepOrderIdx = STEP_ORDER.indexOf(step.key);
        const isComplete = currentIdx >= stepOrderIdx;
        const isLast = idx === STEPPER_STEPS.length - 1;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors
                ${isComplete ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-muted-foreground"}`}>
                {isComplete ? <Check size={10} strokeWidth={3} /> : <span className="text-[9px] font-bold">{idx + 1}</span>}
              </div>
              <span className={`text-[9px] mt-0.5 text-center leading-tight whitespace-nowrap
                ${isComplete ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`h-0.5 flex-1 mx-1 mb-3 rounded ${currentIdx > stepOrderIdx ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function OrderCard({ order, locale }: { order: any; locale: string }) {
  const [expanded, setExpanded] = useState(false);
  const { addItem } = useCart();
  const { t } = useI18n();
  const status = STATUS_LABELS[order.status] ?? { label: order.status, color: "bg-gray-100 text-gray-500" };

  const handleReorder = (e: React.MouseEvent) => {
    e.stopPropagation();
    for (const item of order.order_items ?? []) {
      addItem({
        product_id: item.product_id ?? item.id,
        slug: item.product_id ?? "",
        title: item.product_title_snapshot,
        price: Number(item.product_price_snapshot),
        image: null,
      }, item.quantity);
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Package size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="font-semibold text-sm">{Number(order.total_azn).toFixed(2)} AZN</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
          <span className="text-muted-foreground">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 bg-muted/30 space-y-3">
          <StatusStepper status={order.status} />

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock size={12} />
            {new Date(order.created_at).toLocaleString()}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin size={12} />
            {order.delivery_address}
          </div>
          {Number(order.discount_azn) > 0 && (
            <p className="text-xs text-green-600 font-medium">{t("Profile.orderDiscount")} -{Number(order.discount_azn).toFixed(2)} AZN</p>
          )}
          <div className="space-y-2 pt-1">
            {(order.order_items ?? []).map((item: any) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground line-clamp-1 flex-1 mr-2">{item.product_title_snapshot} ×{item.quantity}</span>
                <span className="font-medium shrink-0">{Number(item.line_total).toFixed(2)} AZN</span>
              </div>
            ))}
          </div>
          {order.notes && (
            <p className="text-xs text-muted-foreground italic">{t("Profile.note")} {order.notes}</p>
          )}
          {(order.order_items ?? []).length > 0 && (
            <button
              onClick={handleReorder}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition pt-1"
            >
              <ShoppingCart size={13} />
              {t("Profile.reorderAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
