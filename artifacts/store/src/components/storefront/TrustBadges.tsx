import { Truck, CreditCard, RotateCcw, ShieldCheck } from "lucide-react";

const badges = [
  {
    icon: Truck,
    title: "Pulsuz Çatdırılma",
    subtitle: "100 AZN-dən yuxarı",
  },
  {
    icon: CreditCard,
    title: "Çatdırılmada Ödəniş",
    subtitle: "Nağd • Kart",
  },
  {
    icon: RotateCcw,
    title: "Asan Qaytarma",
    subtitle: "14 gün ərzində",
  },
  {
    icon: ShieldCheck,
    title: "Təhlükəsiz Alış-veriş",
    subtitle: "Orijinal məhsullar",
  },
];

export default function TrustBadges() {
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
