import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { CartProvider } from "@/lib/cart/context";
import { I18nProvider } from "@/lib/i18n/context";
import StorefrontHeader from "@/components/storefront/Header";
import StorefrontFooter from "@/components/storefront/Footer";

import HomePage from "@/pages/storefront/HomePage";
import ProductsPage from "@/pages/storefront/ProductsPage";
import ProductPage from "@/pages/storefront/ProductPage";
import CategoriesPage from "@/pages/storefront/CategoriesPage";
import CategoryPage from "@/pages/storefront/CategoryPage";
import SearchPage from "@/pages/storefront/SearchPage";
import CheckoutPage from "@/pages/storefront/CheckoutPage";
import ProfilePage from "@/pages/storefront/ProfilePage";
import WishlistPage from "@/pages/storefront/WishlistPage";
import { DeliveryPage, ReturnsPage, TermsPage } from "@/pages/storefront/PoliciesPage";

import AdminLayout from "@/pages/admin/AdminLayout";
import AdminSetupPage from "@/pages/admin/AdminSetupPage";
import DashboardPage from "@/pages/admin/DashboardPage";
import AdminProductsPage from "@/pages/admin/ProductsPage";
import AdminInventoryPage from "@/pages/admin/InventoryPage";
import ProductFormPage from "@/pages/admin/ProductFormPage";
import AdminOrdersPage from "@/pages/admin/OrdersPage";
import OrderDetailPage from "@/pages/admin/OrderDetailPage";
import AdminCouponsPage from "@/pages/admin/CouponsPage";
import AdminCategoriesPage from "@/pages/admin/CategoriesPage";
import AdminCommentsPage from "@/pages/admin/CommentsPage";
import AdminAuditPage from "@/pages/admin/AuditPage";
import BannersPage from "@/pages/admin/BannersPage";
import AdminUsersPage from "@/pages/admin/UsersPage";
import AdminSettingsPage from "@/pages/admin/SettingsPage";

const queryClient = new QueryClient();
const LOCALES = ["az", "ru", "en"];

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function StorefrontLayout({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <I18nProvider locale={locale}>
      <div className="min-h-screen flex flex-col">
        <StorefrontHeader locale={locale} />
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <StorefrontFooter locale={locale} />
      </div>
    </I18nProvider>
  );
}

function AdminRoutes() {
  return (
    <AdminLayout>
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
        <Route>{() => <Redirect to="/admin" />}</Route>
      </Switch>
    </AdminLayout>
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
        <Route>{() => <Redirect to={`/${locale}`} />}</Route>
      </Switch>
    </StorefrontLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <Redirect to="/az" />}</Route>
      <Route path="/admin/setup" component={AdminSetupPage} />
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
