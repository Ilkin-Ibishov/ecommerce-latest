"use client";

import { usePathname, useRouter } from "next/navigation";

const localeLabels: Record<string, string> = {
  az: "AZ",
  ru: "RU",
  en: "EN",
};

export default function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const switchLocale = (locale: string) => {
    const segments = (pathname ?? "/az").split("/");
    segments[1] = locale;
    router.push(segments.join("/"));
  };

  return (
    <div className="flex items-center gap-1 ml-1">
      {Object.entries(localeLabels).map(([locale, label]) => (
        <button
          key={locale}
          onClick={() => switchLocale(locale)}
          className={`text-xs font-medium px-2 py-1 rounded transition ${
            currentLocale === locale
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
