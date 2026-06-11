/**
 * ThemeApplier — A React component that reads settings from SettingsProvider
 * and applies theme (colors + fonts) on initial load and whenever settings update.
 *
 * Requirements: 2.1, 3.1, 3.3
 */
import { useEffect } from "react";
import { useSettings } from "./context";
import { applyTheme } from "./theme-engine";

export function ThemeApplier() {
  const { settings } = useSettings();

  useEffect(() => {
    applyTheme(settings.colors, settings.fonts);
  }, [settings.colors, settings.fonts]);

  // Inject favicon
  useEffect(() => {
    const faviconUrl = settings.favicon_url;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

    if (faviconUrl) {
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = faviconUrl;
    } else {
      // Fall back to default /favicon.ico
      if (link) {
        link.href = "/favicon.ico";
      }
    }
  }, [settings.favicon_url]);

  return null;
}
