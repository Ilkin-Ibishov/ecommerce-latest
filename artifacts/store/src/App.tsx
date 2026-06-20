import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect, lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CartProvider } from "@/lib/cart/context";
import { I18nProvider } from "@/lib/i18n/context";
import { SettingsProvider } from "@/lib/settings/context";
import { ThemeApplier } from "@/lib/settings/ThemeApplier";
import StorefrontHeader from "@/components/storefront/Header";
import StorefrontFooter from "@/components/storefront/Footer";

// ─── Policies pages: small static content, keep synchronous ──────────────────
import { DeliveryPage, ReturnsPage, TermsPage } from "@/pages/storefront/PoliciesPage";

// ─── Storefront pages (lazy — only loaded when route is visited) ─────────────
const HomePage = lazy(() => import("@/pages/storefront/HomePage"));
const ProductsPage = lazy(() => import("@/pages/storefront/ProductsPage"));
const ProductPage = lazy(() => import("@/pages/storefront/ProductPage"));
const CategoriesPage = lazy(() => import("@/pages/storefront/CategoriesPage"));
const CategoryPage = lazy(() => import("@/pages/storefront/CategoryPage"));
const SearchPage = lazy(() => import("@/pages/storefront/SearchPage"));
const CheckoutPage = lazy(() => import("@/pages/storefront/CheckoutPage"));
const ProfilePage = lazy(() => import("@/pages/storefront/ProfilePage"));
const WishlistPage = lazy(() => import("@/pages/storefront/WishlistPage"));
const CmsPage = lazy(() => import("@/pages/storefront/CmsPage"));

// ─── Admin pages (lazy — entire admin chunk only fetched for /admin routes) ──
const AdminLayout = lazy(() => import("@/pages/admin/AdminLayout"));
const AdminSetupPage = lazy(() => import("@/pages/admin/AdminSetupPage"));
const DashboardPage = lazy(() => import("@/pages/admin/DashboardPage"));
const AdminProductsPage = lazy(() => import("@/pages/admin/ProductsPage"));
const AdminInventoryPage = lazy(() => import("@/pages/admin/InventoryPage"));
const ProductFormPage = lazy(() => import("@/pages/admin/ProductFormPage"));
const AdminOrdersPage = lazy(() => import("@/pages/admin/OrdersPage"));
const OrderDetailPage = lazy(() => import("@/pages/admin/OrderDetailPage"));
const AdminCouponsPage = lazy(() => import("@/pages/admin/CouponsPage"));
const AdminCategoriesPage = lazy(() => import("@/pages/admin/CategoriesPage"));
const AdminCommentsPage = lazy(() => import("@/pages/admin/CommentsPage"));
const AdminAuditPage = lazy(() => import("@/pages/admin/AuditPage"));
const BannersPage = lazy(() => import("@/pages/admin/BannersPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/UsersPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/SettingsPage"));
const AdminPagesPage = lazy(() => import("@/pages/admin/PagesPage"));
const PageEditorPage = lazy(() => import("@/pages/admin/PageEditorPage"));
const NotificationCenterPage = lazy(() => import("@/pages/admin/NotificationCenterPage"));

// ─── Platform pages (lazy — super-admin only) ────────────────────────────────
const StoreDashboardPage = lazy(() => import("@/pages/platform/StoreDashboardPage"));
const StoreDetailPage = lazy(() => import("@/pages/platform/StoreDetailPage"));
const PlansPage = lazy(() => import("@/pages/platform/PlansPage"));
const BillingPage = lazy(() => import("@/pages/platform/BillingPage"));
const AnalyticsPage = lazy(() => import("@/pages/platform/AnalyticsPage"));
const PlatformLoginPage = lazy(() => import("@/pages/platform/PlatformLoginPage"));
import { PlatformAuthProvider, usePlatformAuth } from "@/lib/platform/context";

const queryClient = new QueryClient();
const LOCALES = ["az", "ru", "en"];

// ─── Shared loading fallback ─────────────────────────────────────────────────
function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="bouncing-loader">
        <div className="bouncing-circle" />
        <div className="bouncing-circle" />
        <div className="bouncing-circle" />
        <div className="bouncing-shadow" />
        <div className="bouncing-shadow" />
        <div className="bouncing-shadow" />
      </div>
    </div>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function StorefrontLayout({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ThemeApplier />
      <I18nProvider locale={locale}>
        <div className="min-h-screen flex flex-col">
          <StorefrontHeader locale={locale} />
          <main className="flex-1 pb-16 md:pb-0">
            <Suspense fallback={<PageFallback />}>
              {children}
            </Suspense>
          </main>
          <StorefrontFooter locale={locale} />
        </div>
      </I18nProvider>
    </SettingsProvider>
  );
}

function AdminRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <AdminLayout>
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/admin" component={DashboardPage} />
            <Route path="/admin/products/new">{() => <ProductFormPage />}</Route>
            <Route path="/admin/products/:id/edit">{(params) => <ProductFormPage productId={params.id} />}</Route>
            <Route path="/admin/products" component={AdminProductsPage} />
            <Route path="/admin/inventory" component={AdminInventoryPage} />
            <Route path="/admin/orders/:id">{(params) => <OrderDetailPage id={params.id} />}</Route>
            <Route path="/admin/orders" component={AdminOrdersPage} />
            <Route path="/admin/users" component={AdminUsersPage} />
            <Route path="/admin/coupons" component={AdminCouponsPage} />
            <Route path="/admin/banners" component={BannersPage} />
            <Route path="/admin/categories" component={AdminCategoriesPage} />
            <Route path="/admin/comments" component={AdminCommentsPage} />
            <Route path="/admin/audit" component={AdminAuditPage} />
            <Route path="/admin/settings" component={AdminSettingsPage} />
            <Route path="/admin/notifications" component={NotificationCenterPage} />
            <Route path="/admin/pages/:id/edit">{(params) => <PageEditorPage pageId={params.id} />}</Route>
            <Route path="/admin/pages" component={AdminPagesPage} />
            <Route>{() => <Redirect to="/admin" />}</Route>
          </Switch>
        </Suspense>
      </AdminLayout>
    </Suspense>
  );
}

function StorefrontRoutes({ locale }: { locale: string }) {
  return (
    <StorefrontLayout locale={locale}>
      <Switch>
        <Route path={`/${locale}`}>{() => <HomePage locale={locale} />}</Route>
        <Route path={`/${locale}/products`}>{() => <ProductsPage locale={locale} />}</Route>
        <Route path={`/${locale}/products/:slug`}>{(params) => <ProductPage locale={locale} slug={params.slug} />}</Route>
        <Route path={`/${locale}/categories`}>{() => <CategoriesPage locale={locale} />}</Route>
        <Route path={`/${locale}/categories/:slug`}>{(params) => <CategoryPage locale={locale} slug={params.slug} />}</Route>
        <Route path={`/${locale}/search`}>{() => <SearchPage locale={locale} />}</Route>
        <Route path={`/${locale}/checkout`}>{() => <CheckoutPage locale={locale} />}</Route>
        <Route path={`/${locale}/profile`}>{() => <ProfilePage locale={locale} />}</Route>
        <Route path={`/${locale}/wishlist`}>{() => <WishlistPage locale={locale} />}</Route>
        <Route path={`/${locale}/policies/delivery`}>{() => <DeliveryPage locale={locale} />}</Route>
        <Route path={`/${locale}/policies/returns`}>{() => <ReturnsPage locale={locale} />}</Route>
        <Route path={`/${locale}/policies/terms`}>{() => <TermsPage locale={locale} />}</Route>
        <Route path={`/${locale}/page/:slug`}>{(params) => <CmsPage locale={locale} slug={params.slug} />}</Route>
        <Route>{() => <Redirect to={`/${locale}`} />}</Route>
      </Switch>
    </StorefrontLayout>
  );
}

function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { signOut, user } = usePlatformAuth();
  return (
    <SettingsProvider>
      <ThemeApplier />
      <I18nProvider locale="en">
        <div className="min-h-screen flex flex-col">
          <header className="border-b bg-background px-6 py-3 flex items-center justify-between">
            <span className="text-lg font-bold">Platform Control Plane</span>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/platform" className="hover:underline">Stores</a>
              <a href="/platform/plans" className="hover:underline">Plans</a>
              <a href="/platform/billing" className="hover:underline">Billing</a>
              <a href="/platform/analytics" className="hover:underline">Analytics</a>
              {user && (
                <button
                  onClick={() => signOut()}
                  className="text-xs text-muted-foreground hover:text-foreground transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-2 py-1"
                >
                  Sign Out
                </button>
              )}
            </nav>
          </header>
          <main className="flex-1 p-6">
            <Suspense fallback={<PageFallback />}>
              {children}
            </Suspense>
          </main>
        </div>
      </I18nProvider>
    </SettingsProvider>
  );
}

function PlatformAuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, serverSessionReady } = usePlatformAuth();

  if (loading) {
    return <PageFallback />;
  }

  if (!user || !serverSessionReady) {
    return (
      <Suspense fallback={<PageFallback />}>
        <PlatformLoginPage />
      </Suspense>
    );
  }

  return <>{children}</>;
}

function PlatformRoutes() {
  return (
    <PlatformAuthProvider>
      <PlatformAuthGuard>
        <PlatformLayout>
          <Switch>
            <Route path="/platform" component={StoreDashboardPage} />
            <Route path="/platform/stores/:id">{() => <StoreDetailPage />}</Route>
            <Route path="/platform/plans" component={PlansPage} />
            <Route path="/platform/billing" component={BillingPage} />
            <Route path="/platform/analytics" component={AnalyticsPage} />
            <Route>{() => <Redirect to="/platform" />}</Route>
          </Switch>
        </PlatformLayout>
      </PlatformAuthGuard>
    </PlatformAuthProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <Redirect to="/az" />}</Route>
      <Route path="/platform">{() => <PlatformRoutes />}</Route>
      <Route path="/platform/*">{() => <PlatformRoutes />}</Route>
      <Route path="/admin/setup">{() => <Suspense fallback={<PageFallback />}><AdminSetupPage /></Suspense>}</Route>
      <Route path="/admin">{() => <AdminRoutes />}</Route>
      <Route path="/admin/*">{() => <AdminRoutes />}</Route>
      {LOCALES.map((locale) => [
        <Route key={locale} path={`/${locale}`}>{() => <StorefrontRoutes locale={locale} />}</Route>,
        <Route key={`${locale}-sub`} path={`/${locale}/*`}>{() => <StorefrontRoutes locale={locale} />}</Route>,
      ])}
      <Route>{() => <Redirect to="/az" />}</Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ScrollToTop />
          <Router />
        </WouterRouter>
        <Toaster />
      </CartProvider>
    </QueryClientProvider>
  );
}

export default App;
