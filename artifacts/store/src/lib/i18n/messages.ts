const messages: Record<string, Record<string, any>> = {
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
};

export default messages;

export function getT(locale: string) {
  const m = messages[locale] ?? messages.az;
  return function t(key: string): string {
    const parts = key.split(".");
    let cur: any = m;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur === undefined) return key;
    }
    return typeof cur === "string" ? cur : key;
  };
}
