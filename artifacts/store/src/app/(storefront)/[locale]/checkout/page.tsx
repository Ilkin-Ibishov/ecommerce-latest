import type { Metadata } from "next";
import CheckoutClient from "@/components/storefront/checkout-client";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CheckoutClient locale={locale} />;
}
