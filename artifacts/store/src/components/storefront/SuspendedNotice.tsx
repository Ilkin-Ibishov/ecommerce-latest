/**
 * SuspendedNotice — full-page notice displayed when the store's Platform_Status is 'suspended'.
 *
 * This component replaces all normal storefront content (product listings, cart controls,
 * checkout actions) with a localized "Store temporarily unavailable" message.
 * It renders in the active storefront locale (az/ru/en), defaulting to 'az' if unsupported.
 *
 * The API layer returns HTTP 503 for storefront reads when the store is suspended;
 * this component is the SPA-side visual for that state.
 *
 * Feature: super-admin-platform
 * Requirements: 3.3, 3.4, 3.7, 4.1, 4.2, 4.3, 4.5
 */
import { useI18n } from "@/lib/i18n/context";
import { AlertTriangle } from "lucide-react";

export function SuspendedNotice() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="rounded-full bg-amber-100 p-4 mb-6">
        <AlertTriangle className="h-10 w-10 text-amber-600" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-3">
        {t("SuspendedNotice.title")}
      </h1>
      <p className="text-gray-600 max-w-md">
        {t("SuspendedNotice.message")}
      </p>
    </div>
  );
}

export default SuspendedNotice;
