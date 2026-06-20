import { cn } from "@/lib/utils";

interface LocaleSwitcherProps {
  current: string;
  onChange: (locale: string) => void;
}

const locales = ["az", "ru", "en"] as const;

const localeLabels: Record<string, string> = {
  az: "Azerbaijani",
  ru: "Russian",
  en: "English",
};

export function LocaleSwitcher({ current, onChange }: LocaleSwitcherProps) {
  return (
    <div className="flex gap-1" role="group" aria-label="Language selection">
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => onChange(loc)}
          aria-label={`Switch to ${localeLabels[loc]}`}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition",
            loc === current
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {loc.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
