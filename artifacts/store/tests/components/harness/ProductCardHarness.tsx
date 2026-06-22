import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CartProvider } from "@/lib/cart/context";
import { I18nProvider } from "@/lib/i18n/context";
import ProductCard from "@/components/storefront/ProductCard";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * Harness wrapping ProductCard with all required providers for Playwright CT.
 * ProductCard uses useI18n(), useCart(), wouter <Link>, and renders QuickViewModal
 * which calls useQuery() — requiring QueryClientProvider.
 */
export function ProductCardHarness(
  props: React.ComponentProps<typeof ProductCard>,
) {
  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <Router>
          <I18nProvider locale={props.locale}>
            <ProductCard {...props} />
          </I18nProvider>
        </Router>
      </CartProvider>
    </QueryClientProvider>
  );
}
