import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages/schema";
import type { NeedsYouItem } from "./types";

const LINKS_BY_KEY: Record<string, string> = {
  counter_needs_owner: "/admin/counter/sales",
  orders_pending: "/admin/orders",
  low_stock: "/admin/inventory?filter=low_stock",
  holds_overdue: "/admin/reservations",
  reviews_pending: "/admin/comments",
};

interface NeedsYouSectionProps {
  items: NeedsYouItem[];
}

export function NeedsYouSection({ items }: NeedsYouSectionProps) {
  const { t } = useI18n();
  const activeItems = items.filter((item) => item.count > 0);

  return (
    <section className="space-y-3" aria-labelledby="needs-you-heading">
      <h2 id="needs-you-heading" className="text-lg font-semibold">
        {t("Notifications.needsYouTitle")}
      </h2>

      {activeItems.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("Notifications.needsYouEmpty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeItems.map((item) => {
            const link = LINKS_BY_KEY[item.key] ?? "/admin";
            const labelKey = `Notifications.${item.key}` as MessageKey;
            return (
              <Link
                key={item.key}
                href={link}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                <article className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50 hover:border-primary/50">
                  <span className="text-sm font-medium">{t(labelKey)}</span>
                  <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                    {item.count}
                  </span>
                </article>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
