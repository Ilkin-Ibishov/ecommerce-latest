import { X, DollarSign } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

// ── Bulk action toolbar ────────────────────────────────────────────────────
export function BulkBar({ count, onFlag, onDelete, onBulkPrice, onClear }: {
  count: number;
  onFlag: (field: string, value: boolean) => void;
  onDelete: () => void;
  onBulkPrice: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();

  if (count === 0) return null;
  const Btn = ({ label, onClick, destructive, icon }: { label: string; onClick: () => void; destructive?: boolean; icon?: React.ReactNode }) => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 ${
        destructive ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {icon}{label}
    </button>
  );
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm">
      <span className="font-medium text-primary">{t("Admin.Common.selected").replace("{count}", String(count))}</span>
      <div className="flex gap-1.5 ml-2 flex-wrap">
        <Btn label={t("Admin.BulkBar.setFeatured")} onClick={() => onFlag("is_featured", true)} />
        <Btn label={t("Admin.BulkBar.unsetFeatured")} onClick={() => onFlag("is_featured", false)} />
        <Btn label={t("Admin.BulkBar.setOnSale")} onClick={() => onFlag("is_on_sale", true)} />
        <Btn label={t("Admin.BulkBar.unsetOnSale")} onClick={() => onFlag("is_on_sale", false)} />
        <Btn label={t("Admin.BulkBar.bulkPrice")} onClick={onBulkPrice} icon={<DollarSign size={12} />} />
        <Btn label={t("Admin.Common.delete")} onClick={onDelete} destructive />
      </div>
      <button onClick={onClear} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
    </div>
  );
}
