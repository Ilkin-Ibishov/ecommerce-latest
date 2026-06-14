import { useLocation } from "wouter";

export function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const [location] = useLocation();
  const locales = ["az", "ru", "en"];

  const switchLocale = (newLocale: string) => {
    const parts = location.split("/").filter(Boolean);
    if (locales.includes(parts[0])) parts[0] = newLocale;
    else parts.unshift(newLocale);
    window.location.href = `/${parts.join("/")}`;
  };

  return (
    <div className="flex items-center gap-0.5 border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      {locales.map((l) => (
        <button key={l} onClick={() => switchLocale(l)}
          className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-medium transition ${currentLocale === l ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground,0_0%_100%))]" : "text-[hsl(var(--foreground)/0.5)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)]"}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
