import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingCart, Tag, FolderOpen,
  MessageSquare, FileText, LogOut, ShieldCheck, Image,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { LoginModal } from "@/components/auth/LoginModal";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { href: "/admin/coupons", label: "Coupons", icon: Tag },
  { href: "/admin/banners", label: "Banners", icon: Image },
  { href: "/admin/categories", label: "Categories", icon: FolderOpen },
  { href: "/admin/comments", label: "Comments", icon: MessageSquare },
  { href: "/admin/audit", label: "Audit Log", icon: FileText },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const storeName = import.meta.env.VITE_STORE_NAME ?? "Store";

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
      const { data } = await (supabase as any).from("users").select("role").eq("id", user.id).single();
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
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );

  if (!authed) return (
    <div className="admin-theme min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
          <ShieldCheck size={28} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Admin Access Required</h1>
        <p className="text-muted-foreground mb-6">Sign in with your admin phone number to continue.</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setLoginOpen(true)}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition">
            Sign In with Phone
          </button>
          {bootstrapAvailable && (
            <Link href="/admin/setup"
              className="px-5 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-muted/50 transition block">
              First-time Setup
            </Link>
          )}
          <Link href="/az" className="text-sm text-muted-foreground hover:text-foreground transition">
            Return to Store
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

  return (
    <div className="admin-theme min-h-screen flex bg-background text-foreground">
      <aside className="w-56 shrink-0 bg-card border-r border-border flex flex-col h-screen sticky top-0">
        <div className="px-5 py-5 border-b border-border">
          <span className="font-bold text-lg text-primary">{storeName}</span>
          <p className="text-xs text-muted-foreground mt-0.5">Admin Panel</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/admin" ? location === "/admin" : location.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${active ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <button onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition w-full">
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
