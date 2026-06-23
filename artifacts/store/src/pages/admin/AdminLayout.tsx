import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Tag, FolderOpen,
  MessageSquare, FileText, LogOut, ShieldCheck, Image, Menu, X, Settings2,
  BookOpen, Award,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { LoginModal } from "@/components/auth/LoginModal";
import { I18nProvider, useI18n } from "@/lib/i18n/context";
import { LocaleSwitcher } from "@/components/admin/LocaleSwitcher";

export const VALID_LOCALES = ["az", "ru", "en"] as const;
export const LOCALE_STORAGE_KEY = "admin-locale";
export const DEFAULT_LOCALE = "en";

export function getStoredLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (VALID_LOCALES as readonly string[]).includes(stored)) return stored;
  } catch { /* localStorage unavailable (private browsing) */ }
  return DEFAULT_LOCALE;
}

const navItems = [
  { href: "/admin", labelKey: "Admin.Nav.dashboard", icon: LayoutDashboard },
  { href: "/admin/products", labelKey: "Admin.Nav.products", icon: Package },
  { href: "/admin/inventory", labelKey: "Admin.Nav.inventory", icon: Boxes },
  { href: "/admin/orders", labelKey: "Admin.Nav.orders", icon: ShoppingCart },
  { href: "/admin/users", labelKey: "Admin.Nav.customers", icon: Users },
  { href: "/admin/coupons", labelKey: "Admin.Nav.coupons", icon: Tag },
  { href: "/admin/banners", labelKey: "Admin.Nav.banners", icon: Image },
  { href: "/admin/brands", labelKey: "Admin.Nav.brands", icon: Award },
  { href: "/admin/categories", labelKey: "Admin.Nav.categories", icon: FolderOpen },
  { href: "/admin/comments", labelKey: "Admin.Nav.comments", icon: MessageSquare },
  { href: "/admin/audit", labelKey: "Admin.Nav.audit", icon: FileText },
  { href: "/admin/pages", labelKey: "Admin.Nav.pages", icon: BookOpen },
  { href: "/admin/settings", labelKey: "Admin.Nav.settings", icon: Settings2 },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [adminLocale, setAdminLocale] = useState<string>(getStoredLocale);

  // Persist fallback locale when stored value is invalid or missing
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (!stored || !(VALID_LOCALES as readonly string[]).includes(stored)) {
        localStorage.setItem(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  return (
    <I18nProvider locale={adminLocale}>
      <AdminLayoutInner adminLocale={adminLocale} setAdminLocale={setAdminLocale}>
        {children}
      </AdminLayoutInner>
    </I18nProvider>
  );
}

function AdminLayoutInner({
  children,
  adminLocale,
  setAdminLocale,
}: {
  children: ReactNode;
  adminLocale: string;
  setAdminLocale: (locale: string) => void;
}) {
  const { t } = useI18n();
  const [location] = useLocation();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const storeName = import.meta.env.VITE_STORE_NAME ?? "Store";

  // Close sidebar on route change (mobile navigation)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  useEffect(() => {
    const supabase = createClient();
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        try {
          const res = await fetch(apiUrl("/bootstrap/status"));
          const json = await res.json();
          setBootstrapAvailable(json.available === true);
        } catch { /* ignore */ }
        setChecking(false);
        return;
      }
      const { data } = await supabase.from("users").select("role").eq("id", user.id).single();
      if (data?.role === "admin") {
        setAuthed(true);
      } else {
        try {
          const res = await fetch(apiUrl("/bootstrap/status"));
          const json = await res.json();
          setBootstrapAvailable(json.available === true);
        } catch { /* ignore */ }
      }
      setChecking(false);
    }
    check();
  }, []);

  if (checking) return (
    <div className="admin-theme min-h-screen flex items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">{t("Admin.Layout.loading")}</p>
    </div>
  );

  if (!authed) return (
    <div className="admin-theme min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
          <ShieldCheck size={28} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("Admin.Layout.adminAccessRequired")}</h1>
        <p className="text-muted-foreground mb-6">{t("Admin.Layout.signInDescription")}</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setLoginOpen(true)}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition">
            {t("Admin.Layout.signInWithPhone")}
          </button>
          {bootstrapAvailable && (
            <Link href="/admin/setup"
              className="px-5 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-muted/50 transition block">
              {t("Admin.Layout.firstTimeSetup")}
            </Link>
          )}
          <Link href="/az" className="text-sm text-muted-foreground hover:text-foreground transition">
            {t("Admin.Layout.returnToStore")}
          </Link>
        </div>
      </div>
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => window.location.reload()}
      />
    </div>
  );

  const handleSignOut = async () => {
    await fetch(apiUrl("/auth/signout"), { method: "POST" });
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/az";
  };

  const Sidebar = (
    <aside className={`
      fixed top-0 left-0 h-full z-40 w-56 bg-card border-r border-border
      flex flex-col transition-transform duration-200 ease-in-out
      md:translate-x-0 md:sticky md:top-0
      ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
    `}>
      <div className="px-5 py-5 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <span className="font-bold text-lg text-primary">{storeName}</span>
          <p className="text-xs text-muted-foreground mt-0.5">{t("Admin.Layout.adminPanel")}</p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, labelKey, icon: Icon }) => {
          const active = href === "/admin" ? location === "/admin" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon size={16} />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-2 border-t border-border shrink-0">
        <LocaleSwitcher
          current={adminLocale}
          onChange={(locale) => {
            localStorage.setItem(LOCALE_STORAGE_KEY, locale);
            setAdminLocale(locale);
          }}
        />
      </div>
      <div className="p-3 border-t border-border shrink-0">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition w-full"
        >
          <LogOut size={16} />
          {t("Admin.Layout.signOut")}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="admin-theme min-h-screen bg-background text-foreground">
      {/* Mobile overlay — darkens content behind open sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex min-h-screen">
        {/* Desktop: sidebar in normal flow; Mobile: sidebar fixed, overlay */}
        <div className="hidden md:flex md:w-56 md:shrink-0">
          {Sidebar}
        </div>
        {/* Mobile sidebar — always rendered but translated off-screen */}
        <div className="md:hidden">
          {Sidebar}
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile top bar */}
          <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="font-bold text-primary">{storeName}</span>
            <span className="text-xs text-muted-foreground">{t("Admin.Layout.mobileAdmin")}</span>
          </header>

          <main className="flex-1 p-4 md:p-6 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
