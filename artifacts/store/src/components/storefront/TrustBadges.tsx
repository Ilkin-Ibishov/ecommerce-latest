import { Truck, CreditCard, RotateCcw, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export default function TrustBadges() {
  const { t } = useI18n();

  const badges = [
    {
      icon: Truck,
      title: t("TrustBadges.freeDelivery"),
      subtitle: t("TrustBadges.freeDeliverySubtitle"),
    },
    {
      icon: CreditCard,
      title: t("TrustBadges.payOnDelivery"),
      subtitle: t("TrustBadges.payOnDeliverySubtitle"),
    },
    {
      icon: RotateCcw,
      title: t("TrustBadges.easyReturns"),
      subtitle: t("TrustBadges.easyReturnsSubtitle"),
    },
    {
      icon: ShieldCheck,
      title: t("TrustBadges.secureShopping"),
      subtitle: t("TrustBadges.secureShoppingSubtitle"),
    },
  ];

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {badges.map(({ icon: Icon, title, subtitle }) => (
        <div
          key={title}
          className="flex items-center gap-3 bg-card border border-border rounded-xl p-3 md:p-4"
        >
          <div className="w-9 h-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold leading-tight truncate">{title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
