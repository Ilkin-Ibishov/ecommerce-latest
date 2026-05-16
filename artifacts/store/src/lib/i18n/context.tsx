import { createContext, useContext, type ReactNode } from "react";
import { getT } from "./messages";

interface I18nContextValue {
  locale: string;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "az",
  t: getT("az"),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ locale, t: getT(locale) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
