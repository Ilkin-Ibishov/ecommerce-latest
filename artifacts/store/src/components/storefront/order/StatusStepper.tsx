import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import {
  deriveStepStates,
  HAPPY_PATH_STEPS,
  STEP_INDEX,
  type StatusHistoryEntry,
  type StepState,
} from "@/lib/order-tracking/deriveStepStates";

export interface StatusStepperProps {
  status: string;
  history: StatusHistoryEntry[];
  locale: string;
}

const LOCALE_MAP: Record<string, string> = {
  az: "az-AZ",
  ru: "ru-RU",
  en: "en-US",
};

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StepIndicator({ state, index }: { state: StepState; index: number }) {
  if (state === "completed" || state === "success") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="h-4 w-4" />
      </div>
    );
  }

  if (state === "active") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/20">
        <span className="text-xs font-bold">{index + 1}</span>
      </div>
    );
  }

  // future
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <span className="text-xs font-medium">{index + 1}</span>
    </div>
  );
}

function formatTimestamp(changedAt: string, locale: string): string {
  const dateLocale = LOCALE_MAP[locale] || "en-US";
  const date = new Date(changedAt);
  return date.toLocaleDateString(dateLocale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StatusStepper({ status, history, locale }: StatusStepperProps) {
  const { t } = useI18n();
  const stepStates = deriveStepStates(status, history);

  // Determine current active step index for accessibility
  const currentStepIdx = stepStates.findIndex((s) => s === "active");
  const activeIdx =
    currentStepIdx >= 0 ? currentStepIdx : STEP_INDEX[status] ?? 0;
  const currentStepLabel = t(HAPPY_PATH_STEPS[activeIdx].labelKey as any);

  const isTerminalFailure =
    status === "cancelled" || status === "refused_at_delivery";

  return (
    <div className="w-full">
      <div
        className="flex flex-col gap-0 sm:flex-row sm:items-start"
        aria-label={`Order progress: step ${activeIdx + 1} of 5, ${currentStepLabel}`}
        role="group"
      >
        {HAPPY_PATH_STEPS.map((step, i) => {
          const state = stepStates[i];
          const isActive = state === "active";
          const isLast = i === HAPPY_PATH_STEPS.length - 1;

          // Find timestamp for completed/success steps
          const historyEntry =
            state === "completed" || state === "success"
              ? history.find((h) => h.new_status === step.key)
              : undefined;

          const lineCompleted = state === "completed" || state === "success";

          return (
            <div
              key={step.key}
              className={cn("flex", "flex-col", !isLast && "sm:flex-1")}
            >
              {/* Vertical layout (mobile): indicator + label in row, connector below */}
              <div className="flex items-center sm:hidden">
                <StepIndicator state={state} index={i} />
                <div
                  className="ml-3"
                  {...(isActive ? { "aria-current": "step" as const } : {})}
                >
                  <p
                    className={cn(
                      "text-sm",
                      state === "completed" || state === "success"
                        ? "text-primary font-medium"
                        : state === "active"
                          ? "text-primary font-semibold"
                          : "text-muted-foreground",
                    )}
                  >
                    {t(step.labelKey as any)}
                  </p>
                  {historyEntry && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatTimestamp(historyEntry.changed_at, locale)}
                    </p>
                  )}
                </div>
              </div>

              {/* Vertical connector line (mobile) */}
              {!isLast && (
                <div
                  className={cn(
                    "ml-[15px] h-6 w-0.5 sm:hidden",
                    lineCompleted ? "bg-primary" : "bg-muted",
                  )}
                  aria-hidden="true"
                />
              )}

              {/* Horizontal layout (desktop): indicator + line, then label below */}
              <div className="hidden sm:flex sm:items-center">
                <StepIndicator state={state} index={i} />
                {!isLast && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 mx-1",
                      lineCompleted ? "bg-primary" : "bg-muted",
                    )}
                    aria-hidden="true"
                  />
                )}
              </div>

              {/* Desktop label below indicator */}
              <div
                className="hidden sm:block sm:mt-2 sm:text-center sm:pr-2"
                {...(isActive ? { "aria-current": "step" as const } : {})}
              >
                <p
                  className={cn(
                    "text-sm",
                    state === "completed" || state === "success"
                      ? "text-primary font-medium"
                      : state === "active"
                        ? "text-primary font-semibold"
                        : "text-muted-foreground",
                  )}
                >
                  {t(step.labelKey as any)}
                </p>
                {historyEntry && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatTimestamp(historyEntry.changed_at, locale)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Terminal failure badge */}
      {isTerminalFailure && (
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-3 py-1 text-sm font-medium bg-destructive/10 text-destructive">
            {status === "cancelled"
              ? t("OrderTracking.statusCancelled" as any)
              : t("OrderTracking.statusRefusedAtDelivery" as any)}
          </span>
        </div>
      )}
    </div>
  );
}
