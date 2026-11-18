import type { SiteSettings } from "@/lib/settings/context";
import { useI18n } from "@/lib/i18n/context";

interface DeliveryTabProps {
  settings: SiteSettings;
  onChange: (updates: Partial<SiteSettings>) => void;
}

export default function DeliveryTab({ settings, onChange }: DeliveryTabProps) {
  const { t } = useI18n();

  const handleFeeChange = (val: string) => {
    if (val.trim() === "") {
      onChange({ delivery_fee_azn: null });
    } else {
      const num = parseFloat(val);
      onChange({ delivery_fee_azn: isNaN(num) ? null : Math.round(num * 100) / 100 });
    }
  };

  const handleThresholdChange = (val: string) => {
    if (val.trim() === "") {
      onChange({ free_delivery_threshold_azn: null });
    } else {
      const num = parseFloat(val);
      onChange({ free_delivery_threshold_azn: isNaN(num) ? null : Math.round(num * 100) / 100 });
    }
  };

  const fee = settings.delivery_fee_azn;
  const threshold = settings.free_delivery_threshold_azn;

  let summarySentence = "";
  if (fee === null) {
    summarySentence = t("Admin.Settings.deliveryExplanationNull");
  } else if (fee === 0) {
    summarySentence = t("Admin.Settings.deliveryExplanationZero");
  } else {
    if (threshold !== null && threshold > 0) {
      summarySentence = t("Admin.Settings.deliverySummaryWithThreshold")
        .replace("{fee}", fee.toFixed(2))
        .replace("{threshold}", threshold.toFixed(2));
    } else {
      summarySentence = t("Admin.Settings.deliverySummaryFlat").replace("{fee}", fee.toFixed(2));
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-6">
      <h2 className="font-semibold text-base border-b border-border pb-2">
        {t("Admin.Settings.deliverySettings")}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            {t("Admin.Settings.deliveryFeeLabel")}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fee === null ? "" : fee}
            onChange={(e) => handleFeeChange(e.target.value)}
            placeholder={t("Admin.Settings.deliveryFeePlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">
            {t("Admin.Settings.freeDeliveryThresholdLabel")}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={threshold === null ? "" : threshold}
            onChange={(e) => handleThresholdChange(e.target.value)}
            placeholder={t("Admin.Settings.thresholdPlaceholder")}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-muted/40 p-3 rounded-lg text-sm text-muted-foreground border border-border/50">
        <p className="font-medium text-foreground">{summarySentence}</p>
      </div>
    </div>
  );
}
