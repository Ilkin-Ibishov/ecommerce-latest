import { test, expect } from "@playwright/experimental-ct-react";
import StorefrontHeader from "@/components/storefront/Header";
import { CartProvider } from "@/lib/cart/context";
import { Router } from "wouter";

test("desktop nav visible", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });

  const component = await mount(
    <CartProvider>
      <Router>
        <StorefrontHeader locale="az" />
      </Router>
    </CartProvider>,
  );

  // Scope assertions to the <header> element (excludes MobileBottomNav)
  const header = component.locator("header");

  // Logo image visible
  await expect(header.locator('img[alt="İlk Electronics"]')).toBeVisible();

  // Desktop nav links visible (within the header's <nav> element)
  const desktopNav = header.locator("nav");
  await expect(desktopNav.getByRole("link", { name: "Məhsullar" })).toBeVisible();
  await expect(desktopNav.getByRole("link", { name: "Kateqoriyalar" })).toBeVisible();

  // Cart icon button visible
  await expect(header.getByRole("button", { name: "Cart" })).toBeVisible();
});

test("mobile menu toggle", async ({ mount, page }) => {
  await page.setViewportSize({ width: 640, height: 768 });

  const component = await mount(
    <CartProvider>
      <Router>
        <StorefrontHeader locale="az" />
      </Router>
    </CartProvider>,
  );

  // Scope to the <header> element (excludes MobileBottomNav)
  const header = component.locator("header");

  // The mobile dropdown is conditionally rendered (mobileOpen state),
  // so before clicking the hamburger, the dropdown panel doesn't exist.
  // We verify this by checking the dropdown container div with border-t class.
  await expect(header.locator('[class*="border-t"][class*="border-gray-800"][class*="py-3"]')).toHaveCount(0);

  // The hamburger menu toggle is "hidden sm:flex md:hidden" — visible only at 640–767px.
  // At this viewport, it renders a Menu icon (lucide-react SVG with class "lucide-menu").
  const hamburger = header.locator("button:visible").filter({
    has: page.locator("svg.lucide-menu"),
  });
  await hamburger.click();

  // After clicking, the mobile nav panel with "Məhsullar" and "Kateqoriyalar" links becomes visible.
  // The dropdown links have "block" class and are inside the header (not MobileBottomNav).
  const mobilePanel = header.locator("div.border-t");
  await expect(mobilePanel.getByRole("link", { name: "Məhsullar" })).toBeVisible();
  await expect(mobilePanel.getByRole("link", { name: "Kateqoriyalar" })).toBeVisible();
});
