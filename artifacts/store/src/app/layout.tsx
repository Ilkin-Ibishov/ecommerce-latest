import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: process.env.NEXT_PUBLIC_STORE_NAME ?? "Store",
    template: `%s | ${process.env.NEXT_PUBLIC_STORE_NAME ?? "Store"}`,
  },
  description: "Shop online with fast delivery across Azerbaijan.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="az" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
