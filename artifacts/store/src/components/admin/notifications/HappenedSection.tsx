import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages/schema";
import type { InboxEvent } from "./types";

interface HappenedSectionProps {
  events: InboxEvent[];
  onMarkSeen: () => Promise<void>;
  isMarkingSeen?: boolean;
}

function renderEventText(event: InboxEvent, t: (key: MessageKey) => string): string {
  switch (event.kind) {
    case "order_created": {
      const name = event.customer_name || "Customer";
      const id = event.order_id || "";
      return t("Notifications.eventOrder")
        .replace("{name}", name)
        .replace("{id}", id);
    }
    case "counter_sale_voided": {
      const name = event.actor_name || "Staff";
      const number =
        event.sale_number !== undefined && event.sale_number !== null
          ? String(event.sale_number)
          : "-";
      const reason = event.void_reason || "-";
      return t("Notifications.eventVoid")
        .replace("{name}", name)
        .replace("{number}", number)
        .replace("{reason}", reason);
    }
    case "counter_sale_mismatch": {
      const name = event.actor_name || "Staff";
      const number =
        event.sale_number !== undefined && event.sale_number !== null
          ? String(event.sale_number)
          : "-";
      const flagLabels = (event.mismatch_flags || []).map((f) => {
        if (f === "total_mismatch") return t("Notifications.flagTotalMismatch");
        if (f === "price_mismatch") return t("Notifications.flagPriceMismatch");
        if (f === "reservation_override") return t("Notifications.flagReservationOverride");
        return f;
      });
      return t("Notifications.eventMismatch")
        .replace("{name}", name)
        .replace("{number}", number)
        .replace("{flags}", flagLabels.join(", "));
    }
    case "stocktake_posted": {
      const name = event.actor_name || "Staff";
      const number = event.stocktake_number || "-";
      const title = event.title || "";
      return t("Notifications.eventStocktake")
        .replace("{name}", name)
        .replace("{number}", number)
        .replace("{title}", title);
    }
    default:
      return "";
  }
}

export function HappenedSection({ events, onMarkSeen, isMarkingSeen }: HappenedSectionProps) {
  const { t } = useI18n();

  return (
    <section className="space-y-3" aria-labelledby="happened-heading">
      <div className="flex items-center justify-between">
        <h2 id="happened-heading" className="text-lg font-semibold">
          {t("Notifications.happenedTitle")}
        </h2>
        {events.length > 0 && (
          <button
            type="button"
            onClick={onMarkSeen}
            disabled={isMarkingSeen}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("Notifications.markAllSeen")}
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("Notifications.happenedEmpty")}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const text = renderEventText(event, t);
            const content = (
              <article
                className={`rounded-lg border p-4 transition-colors ${
                  event.unread
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:bg-muted/30"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {event.unread && (
                        <span className="inline-flex items-center rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                          {t("Notifications.unread")}
                        </span>
                      )}
                      <time className="text-xs text-muted-foreground" dateTime={event.time}>
                        {new Date(event.time).toLocaleString()}
                      </time>
                    </div>
                    <p className="text-sm font-medium leading-snug">{text}</p>
                  </div>
                </div>
              </article>
            );

            if (event.link) {
              return (
                <Link
                  key={event.id}
                  href={event.link}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                >
                  {content}
                </Link>
              );
            }
            return <div key={event.id}>{content}</div>;
          })}
        </div>
      )}
    </section>
  );
}
