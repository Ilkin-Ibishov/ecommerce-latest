import { test, expect } from "@playwright/experimental-ct-react";
import StorefrontHeader from "@/components/storefront/Header";
import { CartProvider } from "@/lib/cart/context";
import { SettingsProvider } from "@/lib/settings/context";
import { I18nProvider } from "@/lib/i18n/context";
import { Router } from "wouter";

test("desktop nav visible", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });

  const component = await mount(
    <CartProvider>
      <Router>
        <SettingsProvider>
          <I18nProvider locale="az">
            <StorefrontHeader locale="az" />
          </I18nProvider>
        </SettingsProvider>
      </Router>
    </CartProvider>,
  );

  // Scope assertions to the <header> element (excludes MobileBottomNav)
  const header = component.locator("header");

  // Logo link to the storefront home is visible (logo renders as either an
  // <img> when a logo_url is configured, or the store name text otherwise).
  await expect(header.locator('a[href="/az"]').first()).toBeVisible();

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
        <SettingsProvider>
          <I18nProvider locale="az">
            <StorefrontHeader locale="az" />
          </I18nProvider>
        </SettingsProvider>
      </Router>
    </CartProvider>,
  );

  // Scope to the <header> element (excludes MobileBottomNav)
  const header = component.locator("header");

  // The tablet dropdown panel (border-t div) is conditionally rendered only
  // when mobileOpen is true, so it doesn't exist before clicking.
  const dropdown = header.locator("div.border-t");
  await expect(dropdown).toHaveCount(0);

  // The hamburger toggle is "hidden sm:flex md:hidden" — visible at 640–767px.
  // It carries aria-label "Open menu" when closed.
  const hamburger = header.getByRole("button", { name: "Open menu" });
  await hamburger.click();

  // After clicking, the tablet dropdown panel appears with the nav links.
  await expect(dropdown).toHaveCount(1);
  await expect(dropdown.getByRole("link", { name: "Məhsullar" })).toBeVisible();
  await expect(dropdown.getByRole("link", { name: "Kateqoriyalar" })).toBeVisible();
});
