/**
 * Preservation Property Test — Existing Translation Sections Unchanged
 *
 * This test verifies that existing translation sections (HomePage, Auth, Common)
 * are NOT modified during the i18n hardcoded strings fix. It snapshots the current
 * state and ensures these sections maintain their structure and values.
 *
 * This test should PASS on both unfixed and fixed code (preservation guarantee).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
import { describe, it, expect } from "vitest";
import messages, { getT } from "@/lib/i18n/messages";

const LOCALES = ["az", "ru", "en"] as const;
const EXISTING_SECTIONS = ["HomePage", "Auth", "Common"] as const;

/**
 * Snapshot of expected values for existing sections.
 * These are the current values in messages.ts that must remain unchanged.
 */
const EXPECTED_MESSAGES = {
  az: {
    HomePage: {
      hero: {
        title: "Ən yaxşı məhsullar burada",
        subtitle: "Azərbaycana sürətli çatdırılma ilə keyfiyyətli məhsullar",
        cta: "Alış-verişə başla",
      },
      sections: {
        categories: "Kateqoriyalar",
        featured: "Seçilmiş məhsullar",
        onSale: "Endirimlər",
        dealOfDay: "Günün təklifi",
        viewAll: "Hamısına bax",
      },
      empty: {
        title: "Məhsullar tezliklə əlavə olunacaq",
        subtitle: "Mağazamız hazırlanır. Tezliklə geri qayıdın!",
      },
    },
    Auth: {
      signIn: "Daxil ol",
      signOut: "Çıxış",
      phone: "Telefon nömrəsi",
      sendCode: "Kod göndər",
      enterCode: "Kodu daxil edin",
      verify: "Təsdiqlə",
      name: "Ad Soyad",
      continue: "Davam et",
      skip: "Keç",
    },
    Common: {
      search: "Axtar",
      cart: "Səbət",
      wishlist: "Sevimlilər",
      loading: "Yüklənir...",
      error: "Xəta baş verdi",
      retry: "Yenidən cəhd et",
    },
  },
  ru: {
    HomePage: {
      hero: {
        title: "Лучшие товары здесь",
        subtitle: "Качественные товары с быстрой доставкой по Азербайджану",
        cta: "Начать покупки",
      },
      sections: {
        categories: "Категории",
        featured: "Рекомендуемые товары",
        onSale: "Скидки",
        dealOfDay: "Сделка дня",
        viewAll: "Смотреть все",
      },
      empty: {
        title: "Товары скоро будут добавлены",
        subtitle: "Наш магазин готовится. Возвращайтесь позже!",
      },
    },
    Auth: {
      signIn: "Войти",
      signOut: "Выйти",
      phone: "Номер телефона",
      sendCode: "Отправить код",
      enterCode: "Введите код",
      verify: "Подтвердить",
      name: "Имя Фамилия",
      continue: "Продолжить",
      skip: "Пропустить",
    },
    Common: {
      search: "Поиск",
      cart: "Корзина",
      wishlist: "Избранное",
      loading: "Загрузка...",
      error: "Произошла ошибка",
      retry: "Повторить",
    },
  },
  en: {
    HomePage: {
      hero: {
        title: "The best products are here",
        subtitle: "Quality products with fast delivery across Azerbaijan",
        cta: "Start Shopping",
      },
      sections: {
        categories: "Categories",
        featured: "Featured Products",
        onSale: "On Sale",
        dealOfDay: "Deal of the Day",
        viewAll: "View All",
      },
      empty: {
        title: "Products coming soon",
        subtitle: "Our store is being set up. Check back soon!",
      },
    },
    Auth: {
      signIn: "Sign In",
      signOut: "Sign Out",
      phone: "Phone Number",
      sendCode: "Send Code",
      enterCode: "Enter Code",
      verify: "Verify",
      name: "Full Name",
      continue: "Continue",
      skip: "Skip",
    },
    Common: {
      search: "Search",
      cart: "Cart",
      wishlist: "Wishlist",
      loading: "Loading...",
      error: "An error occurred",
      retry: "Retry",
    },
  },
} as const;

describe("i18n preservation — existing sections unchanged", () => {
  describe("existing sections exist for all 3 locales", () => {
    for (const locale of LOCALES) {
      for (const section of EXISTING_SECTIONS) {
        it(`messages.${locale}.${section} exists`, () => {
          expect(messages[locale]).toBeDefined();
          expect(messages[locale][section]).toBeDefined();
        });
      }
    }
  });

  describe("existing sections have their original structure and values", () => {
    for (const locale of LOCALES) {
      for (const section of EXISTING_SECTIONS) {
        it(`messages.${locale}.${section} matches expected snapshot`, () => {
          const actual = messages[locale][section];
          const expected =
            EXPECTED_MESSAGES[locale][section as keyof (typeof EXPECTED_MESSAGES)[typeof locale]];
          expect(actual).toEqual(expected);
        });
      }
    }
  });

  describe("t() function API works correctly — key lookup returns correct value", () => {
    for (const locale of LOCALES) {
      it(`t() resolves flat keys correctly for locale "${locale}"`, () => {
        const t = getT(locale);
        const expected =
          EXPECTED_MESSAGES[locale]["Auth" as keyof (typeof EXPECTED_MESSAGES)[typeof locale]] as Record<string, string>;
        expect(t("Auth.signIn")).toBe(expected.signIn);
        expect(t("Auth.signOut")).toBe(expected.signOut);
        expect(t("Auth.phone")).toBe(expected.phone);
      });

      it(`t() resolves nested keys correctly for locale "${locale}"`, () => {
        const t = getT(locale);
        const homePage =
          EXPECTED_MESSAGES[locale]["HomePage" as keyof (typeof EXPECTED_MESSAGES)[typeof locale]] as {
            hero: { title: string; subtitle: string; cta: string };
            sections: Record<string, string>;
          };
        expect(t("HomePage.hero.title")).toBe(homePage.hero.title);
        expect(t("HomePage.hero.subtitle")).toBe(homePage.hero.subtitle);
        expect(t("HomePage.sections.categories")).toBe(homePage.sections.categories);
      });

      it(`t() returns key path for missing keys in locale "${locale}"`, () => {
        const t = getT(locale);
        expect(t("NonExistent.key")).toBe("NonExistent.key");
        expect(t("HomePage.nonExistentKey")).toBe("HomePage.nonExistentKey");
      });
    }
  });

  describe('existing sections (HomePage, Auth, Common) do NOT contain standalone "AZN" currency code', () => {
    function collectLeafValues(obj: unknown, path: string, results: string[]): void {
      if (typeof obj === "string") {
        results.push(obj);
        return;
      }
      if (typeof obj === "object" && obj !== null) {
        for (const [key, value] of Object.entries(obj)) {
          collectLeafValues(value, `${path}.${key}`, results);
        }
      }
    }

    for (const locale of LOCALES) {
      for (const section of EXISTING_SECTIONS) {
        it(`messages.${locale}.${section} does not contain "AZN"`, () => {
          const sectionMessages = messages[locale]?.[section];
          if (!sectionMessages) return;
          const allValues: string[] = [];
          collectLeafValues(sectionMessages, `${locale}.${section}`, allValues);

          for (const value of allValues) {
            expect(
              value.includes("AZN"),
              `Found "AZN" in translation value "${value}" in messages.${locale}.${section}. ` +
                `Currency codes should remain as literals in code, not in translations.`,
            ).toBe(false);
          }
        });
      }
    }
  });
});
