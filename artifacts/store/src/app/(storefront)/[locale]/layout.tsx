import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import StorefrontHeader from "@/components/storefront/header";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "az" | "ru" | "en")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="min-h-screen flex flex-col">
        <StorefrontHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border bg-secondary/30 py-8 mt-auto">
          <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
            <p>
              © {new Date().getFullYear()}{" "}
              {process.env.NEXT_PUBLIC_STORE_NAME ?? "Store"}. All rights
              reserved.
            </p>
            <div className="flex justify-center gap-4 mt-2">
              <a
                href={`/${locale}/policies/terms`}
                className="hover:underline"
              >
                Terms of Service
              </a>
              <a
                href={`/${locale}/policies/privacy`}
                className="hover:underline"
              >
                Privacy Policy
              </a>
              <a
                href={`/${locale}/policies/delivery`}
                className="hover:underline"
              >
                Delivery Info
              </a>
            </div>
          </div>
        </footer>
      </div>
    </NextIntlClientProvider>
  );
}
