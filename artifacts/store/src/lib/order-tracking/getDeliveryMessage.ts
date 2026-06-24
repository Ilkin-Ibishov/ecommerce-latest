import type { StatusHistoryEntry } from "./deriveStepStates";

const LOCALE_MAP: Record<string, string> = {
  az: "az-AZ",
  ru: "ru-RU",
  en: "en-US",
};

export function formatDeliveryDate(changedAt: string, locale: string): string {
  const dateLocale = LOCALE_MAP[locale] || "en-US";
  return new Date(changedAt).toLocaleDateString(dateLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Returns the i18n key and optional interpolation data for the delivery info section,
 * or null if the section should be hidden (terminal failure states).
 */
export function getDeliveryInfo(
  status: string,
  history: StatusHistoryEntry[],
  locale: string,
): { key: string; params?: Record<string, string> } | null {
  switch (status) {
    case "shipped":
      return { key: "OrderTracking.estimatedDelivery" };
    case "courier_assigned":
      return { key: "OrderTracking.courierPreparing" };
    case "delivered": {
      const deliveredEntry = history.find((h) => h.new_status === "delivered");
      if (deliveredEntry) {
        return {
          key: "OrderTracking.deliveredAt",
          params: { date: formatDeliveryDate(deliveredEntry.changed_at, locale) },
        };
      }
      return { key: "OrderTracking.delivered" };
    }
    case "cancelled":
    case "refused_at_delivery":
      return null; // Hide section entirely
    default:
      return { key: "OrderTracking.processingOrder" };
  }
}
