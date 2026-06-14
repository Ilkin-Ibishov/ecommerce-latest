import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export function StarDisplay({ rating, count }: { rating: number; count: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={16}
          className={s <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"}
        />
      ))}
      <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
      <span className="text-sm text-muted-foreground">({count} {t("ProductDetail.reviewCount")})</span>
    </div>
  );
}
