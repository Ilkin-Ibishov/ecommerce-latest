import { useI18n } from "@/lib/i18n/context";

/**
 * SuspendedNotice — Shown when the store's platform_status is 'suspended'.
 *
 * Renders a localized "store temporarily unavailable" message using useI18n() t(key).
 * Excludes all product listings, cart controls, and checkout actions — just the notice.
 *
 * The page detects suspension from the API response (503 status) and renders this component.
 *
 * Feature: super-admin-platform
 * Requirements: 3.3, 3.4, 3.7, 4.1, 4.2, 4.3, 4.5
 */
export default function SuspendedNotice() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="max-w-md space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("SuspendedNotice.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("SuspendedNotice.message")}
        </p>
      </div>
    </div>
  );
}
