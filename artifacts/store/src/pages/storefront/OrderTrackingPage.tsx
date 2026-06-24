import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { userFetch } from "@/lib/user-fetch";
import { StatusStepper } from "@/components/storefront/order/StatusStepper";
import type { StatusHistoryEntry } from "@/lib/order-tracking/deriveStepStates";

interface OrderTrackingPageProps {
  locale: string;
  shortId: string;
}

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  product_price_snapshot: number;
  product_title_snapshot: string;
  line_total: number;
}

interface OrderData {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  total_azn: number;
  discount_azn: number;
  created_at: string;
  order_items: OrderItem[];
  status_history: StatusHistoryEntry[];
}

const LOCALE_MAP: Record<string, string> = {
  az: "az-AZ",
  ru: "ru-RU",
  en: "en-US",
};

function formatCurrency(amount: number): string {
  return `${amount.toFixed(2)} AZN`;
}

function formatDate(dateStr: string, locale: string): string {
  const dateLocale = LOCALE_MAP[locale] || "en-US";
  const date = new Date(dateStr);
  return date.toLocaleDateString(dateLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDeliveryMessage(
  status: string,
  history: StatusHistoryEntry[],
  locale: string,
  t: (key: string) => string,
): string | null {
  switch (status) {
    case "shipped":
      return t("OrderTracking.estimatedDelivery");
    case "courier_assigned":
      return t("OrderTracking.courierPreparing");
    case "delivered": {
      const deliveredEntry = history.find((h) => h.new_status === "delivered");
      if (deliveredEntry) {
        const dateLocale = LOCALE_MAP[locale] || "en-US";
        const date = new Date(deliveredEntry.changed_at);
        const formatted = date.toLocaleDateString(dateLocale, {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `${t("OrderTracking.deliveredAt")} ${formatted}`;
      }
      return t("OrderTracking.delivered");
    }
    case "cancelled":
    case "refused_at_delivery":
      return null;
    default:
      return t("OrderTracking.processingOrder");
  }
}

export default function OrderTrackingPage({ locale, shortId }: OrderTrackingPageProps) {
  const { t } = useI18n();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ type: "auth" | "not_found" | "network" } | null>(null);

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch(apiUrl(`/profile/orders/${shortId}`));
      if (res.status === 401) {
        setError({ type: "auth" });
        return;
      }
      if (res.status === 404) {
        setError({ type: "not_found" });
        return;
      }
      if (!res.ok) {
        setError({ type: "network" });
        return;
      }
      const data: OrderData = await res.json();
      setOrder(data);
    } catch {
      setError({ type: "network" });
    } finally {
      setLoading(false);
    }
  }, [shortId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-24 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // Auth error - sign in required
  if (error?.type === "auth") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("OrderTracking.orderTracking")}</h1>
        <p className="text-muted-foreground mb-4">{t("OrderTracking.signInRequired")}</p>
        <Link
          href={`/${locale}/profile`}
          className="text-primary hover:underline focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
        >
          {t("OrderTracking.backToProfile")}
        </Link>
      </div>
    );
  }

  // Not found error
  if (error?.type === "not_found") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("OrderTracking.orderTracking")}</h1>
        <p className="text-muted-foreground mb-4">{t("OrderTracking.orderNotFound")}</p>
        <Link
          href={`/${locale}/profile`}
          className="text-primary hover:underline focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
        >
          {t("OrderTracking.backToProfile")}
        </Link>
      </div>
    );
  }

  // Network error with retry
  if (error?.type === "network") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("OrderTracking.orderTracking")}</h1>
        <p className="text-muted-foreground mb-4">{t("OrderTracking.networkError")}</p>
        <button
          onClick={fetchOrder}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium hover:bg-primary/90 transition focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t("OrderTracking.retry")}
        </button>
      </div>
    );
  }

  // No order data (shouldn't happen, but guard)
  if (!order) return null;

  const deliveryMessage = getDeliveryMessage(order.status, order.status_history, locale, t);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Page title */}
      <h1 className="text-2xl font-bold mb-6">{t("OrderTracking.orderTracking")}</h1>

      {/* Status Stepper */}
      <div className="mb-8">
        <StatusStepper
          status={order.status}
          history={order.status_history}
          locale={locale}
        />
      </div>

      {/* Order details section */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">{t("OrderTracking.orderDetails")}</h2>

        <div className="space-y-3">
          {/* Customer name */}
          <div>
            <span className="text-muted-foreground text-sm">{t("OrderTracking.customerName")}</span>
            <p className="font-medium">{order.customer_name}</p>
          </div>

          {/* Delivery address */}
          <div>
            <span className="text-muted-foreground text-sm">{t("OrderTracking.deliveryAddress")}</span>
            <p className="font-medium">{order.delivery_address}</p>
          </div>

          {/* Order date */}
          <div>
            <span className="text-muted-foreground text-sm">{t("OrderTracking.orderDate")}</span>
            <p className="font-medium">{formatDate(order.created_at, locale)}</p>
          </div>
        </div>
      </section>

      {/* Order items section */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">{t("OrderTracking.orderItems")}</h2>

        <div className="space-y-3">
          {order.order_items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between border-b border-border pb-3 last:border-0"
            >
              <div>
                <p className="font-medium">{item.product_title_snapshot}</p>
                <p className="text-sm text-muted-foreground">
                  {t("OrderTracking.quantity")}: {item.quantity}
                </p>
              </div>
              <p className="font-medium">{formatCurrency(item.line_total)}</p>
            </div>
          ))}
        </div>

        {/* Discount (only if > 0) */}
        {order.discount_azn > 0 && (
          <div className="flex items-center justify-between mt-4 text-green-600">
            <span>{t("OrderTracking.discount")}</span>
            <span>-{formatCurrency(order.discount_azn)}</span>
          </div>
        )}

        {/* Order total */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span className="font-semibold">{t("OrderTracking.orderTotal")}</span>
          <span className="font-bold text-lg">{formatCurrency(order.total_azn)}</span>
        </div>
      </section>

      {/* Delivery info section */}
      {deliveryMessage && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-2">{t("OrderTracking.deliveryInfo")}</h2>
          <p className="text-muted-foreground">{deliveryMessage}</p>
        </section>
      )}

      {/* Back to profile link */}
      <Link
        href={`/${locale}/profile`}
        className="text-primary hover:underline text-sm focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
      >
        ← {t("OrderTracking.backToProfile")}
      </Link>
    </div>
  );
}
