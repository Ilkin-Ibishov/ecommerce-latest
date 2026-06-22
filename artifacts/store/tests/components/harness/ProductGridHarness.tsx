import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CartProvider } from "@/lib/cart/context";
import { I18nProvider } from "@/lib/i18n/context";
import { ProductGrid, type ProductGridProps } from "@/components/storefront/ProductGrid";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * Harness wrapping ProductGrid with all required providers for Playwright CT.
 * ProductGrid renders ProductCard which uses useI18n(), useCart(), wouter <Link>,
 * and QuickViewModal (useQuery) — requiring all four providers.
 */
export function ProductGridHarness(props: ProductGridProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <Router>
          <I18nProvider locale={props.locale}>
            <ProductGrid {...props} />
          </I18nProvider>
        </Router>
      </CartProvider>
    </QueryClientProvider>
  );
}
