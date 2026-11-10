// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import CheckoutPage from "@/pages/storefront/CheckoutPage";

vi.mock("@/lib/cart/context", () => ({
  useCart: () => ({
    items: [
      {
        product_id: "prod-1",
        slug: "test-prod",
        title: "Test Product",
        price: 50,
        image: null,
        quantity: 1,
      },
    ],
    subtotal: 50,
    removeItem: vi.fn(),
    clearCart: vi.fn(),
    updateQty: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useProfile", () => ({
  useProfile: () => ({
    profile: null,
    loading: false,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "Checkout.placeOrder": "Sifariş ver",
        "Checkout.yourInfo": "Məlumatlarınız",
        "Checkout.nameLabel": "Ad, Soyad",
        "Checkout.namePlaceholder": "Adınız",
        "Checkout.phoneLabel": "Əlaqə nömrəsi",
        "Checkout.phonePlaceholder": "+994 XX XXX XX XX",
        "Checkout.addressLabel": "Çatdırılma ünvanı",
        "Checkout.addressPlaceholder": "Şəhər, küçə, ev nömrəsi",
        "Checkout.notesLabel": "Qeyd (istəyə görə)",
        "Checkout.notesPlaceholder": "Kuryer üçün qeyd…",
        "Checkout.promoCode": "Promo Kod",
        "Checkout.enterCode": "KOD DAXİL EDİN",
        "Checkout.apply": "Tətbiq et",
        "Checkout.orderSummary": "Sifariş xülasəsi",
        "Checkout.subtotal": "Ara cəm",
        "Checkout.delivery": "Çatdırılma",
        "Checkout.free": "Pulsuz",
        "Checkout.total": "Cəmi",
        "Checkout.cashPayment": "Nağd ödəniş",
      };
      return dict[key] ?? key;
    },
    locale: "az",
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: any) => children,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CheckoutPage input security constraints (S1 / Task D)", () => {
  it("enforces maxLength attributes on all checkout form inputs and textareas", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "prod-1": { price: 50, available: 10 } }),
    }));

    const { container } = render(
      React.createElement(CheckoutPage, { locale: "az" }),
    );

    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Adınız"]');
    expect(nameInput).not.toBeNull();
    expect(nameInput?.maxLength).toBe(100);

    const phoneInput = container.querySelector<HTMLInputElement>('input[placeholder="+994 XX XXX XX XX"]');
    expect(phoneInput).not.toBeNull();
    expect(phoneInput?.maxLength).toBe(25);

    const addressInput = container.querySelector<HTMLInputElement>('input[placeholder="Şəhər, küçə, ev nömrəsi"]');
    expect(addressInput).not.toBeNull();
    expect(addressInput?.maxLength).toBe(250);

    const notesTextarea = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="Kuryer üçün qeyd…"]');
    expect(notesTextarea).not.toBeNull();
    expect(notesTextarea?.maxLength).toBe(500);

    const couponInput = container.querySelector<HTMLInputElement>('input[placeholder="KOD DAXİL EDİN"]');
    expect(couponInput).not.toBeNull();
    expect(couponInput?.maxLength).toBe(50);
  });
});
