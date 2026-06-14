import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { LoginModal } from "@/components/auth/LoginModal";
import { useProfile } from "@/lib/hooks/useProfile";
import { useI18n } from "@/lib/i18n/context";
import { OrderCard } from "@/components/storefront/profile/OrderCard";
import { InlineEditor } from "@/components/storefront/profile/InlineEditor";
import { Package, User, Home } from "lucide-react";

export default function ProfilePage({ locale }: { locale: string }) {
  const [user, setUser] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const supabase = createClient();
  const { profile, loading: profileLoading, updateProfile } = useProfile();
  const { t } = useI18n();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: any) => {
      setUser(data.user ?? null);
      setPageLoading(false);
      if (data.user) loadOrders();
      else setOrdersLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: any, session: any) => {
      setUser(session?.user ?? null);
      if (session?.user) loadOrders();
      else { setOrders([]); setOrdersLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl("/profile/orders"), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setOrders(await res.json());
    } catch {}
    setOrdersLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setOrders([]);
  };

  if (pageLoading) {
    return <div className="container mx-auto px-4 py-16 text-center text-muted-foreground">{t("Profile.loading")}</div>;
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Package size={36} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("Profile.signInTitle")}</h1>
        <p className="text-muted-foreground mb-6">{t("Profile.signInPrompt")}</p>
        <button
          onClick={() => setShowLogin(true)}
          className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition"
        >
          {t("Profile.signInButton")}
        </button>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onSuccess={() => {}} />
      </div>
    );
  }

  const displayName = profile?.full_name || profile?.phone || user?.phone || user?.email || "there";

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Profile.title")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("Profile.welcomeBack").replace("{name}", displayName)}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm text-muted-foreground hover:text-destructive transition border border-border px-4 py-2 rounded-lg"
        >
          {t("Profile.signOut")}
        </button>
      </div>

      {/* ── Personal Info ── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <User size={16} /> {t("Profile.personalInfo")}
        </h2>
        {profileLoading ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t("Profile.loading")}</p>
        ) : (
          <>
            <InlineEditor
              label={t("Profile.phoneNumber")}
              value={profile?.phone ?? user?.phone ?? ""}
              readOnly
            />
            <InlineEditor
              label={t("Profile.fullName")}
              value={profile?.full_name ?? ""}
              placeholder={t("Profile.addName")}
              onSave={(v) => updateProfile({ full_name: v })}
            />
          </>
        )}
      </section>

      {/* ── Default Delivery Address ── */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2 text-base">
          <Home size={16} /> {t("Profile.defaultAddress")}
        </h2>
        {profileLoading ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t("Profile.loading")}</p>
        ) : (
          <>
            <InlineEditor
              label={t("Profile.addressLabel")}
              value={profile?.default_address ?? ""}
              placeholder={t("Profile.addressPlaceholder")}
              multiline
              onSave={(v) => updateProfile({ default_address: v })}
            />
            <p className="text-xs text-muted-foreground">
              {t("Profile.addressNote")}
            </p>
          </>
        )}
      </section>

      {/* ── Orders ── */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Package size={18} /> {t("Profile.myOrders")}
          {orders.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{orders.length}</span>
          )}
        </h2>

        {ordersLoading ? (
          <div className="text-center py-12 text-muted-foreground">{t("Profile.loading")}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <Package size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{t("Profile.noOrders")}</p>
            <Link href={`/${locale}/products`} className="text-primary hover:underline text-sm mt-2 inline-block">
              {t("Profile.startShopping")}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
