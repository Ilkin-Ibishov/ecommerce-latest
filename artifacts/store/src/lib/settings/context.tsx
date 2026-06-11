import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/lib/api";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ColorPalette {
  primary: string; // HSL: "220 70% 50%"
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
}

export interface FontConfig {
  heading: string; // Font family name
  body: string;
}

export interface ContactInfo {
  phone: string;
  email: string;
  address: string;
  social_links: {
    instagram?: string;
    facebook?: string;
    telegram?: string;
  };
}

export interface SiteSettings {
  id: string;
  store_name: Record<string, string>; // { az, ru, en }
  colors: ColorPalette;
  fonts: FontConfig;
  logo_url: string | null;
  favicon_url: string | null;
  contact: ContactInfo;
  working_hours: Record<string, string>;
  footer_text: Record<string, string>;
  updated_at: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: SiteSettings = {
  id: "00000000-0000-0000-0000-000000000001",
  store_name: { az: "", ru: "", en: "" },
  colors: {
    primary: "220 70% 50%",
    secondary: "220 20% 20%",
    accent: "45 93% 47%",
    background: "0 0% 100%",
    text: "220 20% 10%",
    muted: "220 10% 60%",
  },
  fonts: { heading: "Inter", body: "Inter" },
  logo_url: null,
  favicon_url: null,
  contact: { phone: "", email: "", address: "", social_links: {} },
  working_hours: { az: "", ru: "", en: "" },
  footer_text: { az: "", ru: "", en: "" },
  updated_at: "",
};

// ─── Context ─────────────────────────────────────────────────────────────────

interface SettingsContextValue {
  settings: SiteSettings;
  getStoreName: (locale: string) => string;
  getWorkingHours: (locale: string) => string;
  getFooterText: (locale: string) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY = "site_settings";
const CACHE_TIMESTAMP_KEY = "site_settings_cached_at";
const FETCH_TIMEOUT_MS = 10_000;

/** Cache is considered stale after 5 minutes (300 seconds) */
export const STALE_THRESHOLD_MS = 5 * 60 * 1000;
/** Cache expires completely after 24 hours */
export const EXPIRY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readCachedSettings(): SiteSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Basic shape validation
    if (parsed && typeof parsed === "object" && typeof parsed.updated_at === "string") {
      return parsed as SiteSettings;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedSettings(settings: SiteSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}

/** Returns the time (in ms since epoch) when the cache was last written */
export function getCacheTimestamp(): number | null {
  try {
    const raw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

/** Returns the age of the cache in milliseconds, or null if no cache */
export function getCacheAgeMs(): number | null {
  const ts = getCacheTimestamp();
  if (ts === null) return null;
  return Date.now() - ts;
}

/** Returns true if cached settings are older than the stale threshold (5 min) */
export function isCacheStale(): boolean {
  const age = getCacheAgeMs();
  if (age === null) return true; // No cache = treat as stale
  return age > STALE_THRESHOLD_MS;
}

/** Returns true if cached settings are older than the expiry threshold (24h) */
export function isCacheExpired(): boolean {
  const age = getCacheAgeMs();
  if (age === null) return true; // No cache = treat as expired
  return age > EXPIRY_THRESHOLD_MS;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  // Use useState initializer to read from localStorage in the same render frame
  const [settings, setSettings] = useState<SiteSettings>(() => {
    const cached = readCachedSettings();
    return cached ?? DEFAULT_SETTINGS;
  });

  // Track whether a fetch is currently in-flight to avoid duplicate requests
  const fetchInFlightRef = useRef(false);

  const revalidate = useCallback(() => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(apiUrl("/site-settings"), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((serverSettings: SiteSettings) => {
        // Always update if cache is stale (> 5 min) — replace immediately
        const stale = isCacheStale();

        if (stale) {
          // Stale cache: replace with fetch result immediately
          setSettings(serverSettings);
          writeCachedSettings(serverSettings);
        } else {
          // Fresh cache: only update if server is newer (timestamp comparison)
          setSettings((current) => {
            const cachedUpdatedAt = current.updated_at;
            const serverUpdatedAt = serverSettings.updated_at;

            if (
              !cachedUpdatedAt ||
              (serverUpdatedAt && serverUpdatedAt > cachedUpdatedAt)
            ) {
              writeCachedSettings(serverSettings);
              return serverSettings;
            }
            return current;
          });
        }
      })
      .catch(() => {
        // On fetch failure:
        // - If cache > 24 hours: fall back to hardcoded defaults
        // - Otherwise: continue using cached settings silently (retry on next navigation)
        if (isCacheExpired()) {
          setSettings(DEFAULT_SETTINGS);
        }
        // If not expired, do nothing — continue with current cached settings
      })
      .finally(() => {
        clearTimeout(timeoutId);
        fetchInFlightRef.current = false;
      });

    // Return cleanup function for abort
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
      fetchInFlightRef.current = false;
    };
  }, []);

  // Trigger revalidation on mount and on every route navigation
  useEffect(() => {
    const cleanup = revalidate();
    return cleanup;
  }, [location, revalidate]);

  const getStoreName = useCallback(
    (locale: string): string => {
      const name = settings.store_name[locale];
      if (name && name.trim()) return name;
      const azName = settings.store_name["az"];
      if (azName && azName.trim()) return azName;
      return "Store";
    },
    [settings.store_name],
  );

  const getWorkingHours = useCallback(
    (locale: string): string => {
      const value = settings.working_hours[locale];
      if (value && value.trim()) return value;
      const azValue = settings.working_hours["az"];
      if (azValue && azValue.trim()) return azValue;
      return "";
    },
    [settings.working_hours],
  );

  const getFooterText = useCallback(
    (locale: string): string => {
      const value = settings.footer_text[locale];
      if (value && value.trim()) return value;
      const azValue = settings.footer_text["az"];
      if (azValue && azValue.trim()) return azValue;
      return "";
    },
    [settings.footer_text],
  );

  return (
    <SettingsContext.Provider value={{ settings, getStoreName, getWorkingHours, getFooterText }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
