const DELIVERY_CONTENT: Record<string, { title: string; points: string[] }> = {
  az: { title: "Çatdırılma Məlumatı", points: ["Çatdırılma yalnız Azərbaycan ərazisini əhatə edir.", "Çatdırılma müddəti: adətən 1-3 iş günü.", "Ödəniş çatdırılma zamanı nağd şəkildə həyata keçirilir (AZN).", "Minimum sifariş məbləği yoxdur.", "Çatdırılma haqqı sabit tariflə hesablanır.", "Sifarişin statusunu WhatsApp vasitəsilə izləmək olar."] },
  ru: { title: "Информация о доставке", points: ["Доставка осуществляется только по территории Азербайджана.", "Срок доставки: обычно 1-3 рабочих дня.", "Оплата производится наличными при доставке (AZN).", "Минимальная сумма заказа отсутствует.", "Стоимость доставки рассчитывается по фиксированному тарифу.", "Статус заказа можно отслеживать через WhatsApp."] },
  en: { title: "Delivery Information", points: ["Delivery covers Azerbaijan territory only.", "Delivery time: usually 1-3 business days.", "Payment is made in cash upon delivery (AZN).", "No minimum order amount.", "Delivery fee is calculated at a flat rate.", "Order status can be tracked via WhatsApp."] },
};

const RETURNS_CONTENT: Record<string, { title: string; points: string[] }> = {
  az: { title: "Qaytarma Siyasəti", points: ["Məhsullar çatdırılmadan 24 saat ərzində qaytarıla bilər.", "Məhsul orijinal qablaşdırmada olmalıdır.", "Zədəli məhsullar dərhal əvəzlənir.", "Qaytarma üçün WhatsApp vasitəsilə əlaqə saxlayın."] },
  ru: { title: "Политика возврата", points: ["Товары можно вернуть в течение 24 часов после доставки.", "Товар должен быть в оригинальной упаковке.", "Поврежденные товары заменяются немедленно.", "Для возврата свяжитесь через WhatsApp."] },
  en: { title: "Returns Policy", points: ["Products can be returned within 24 hours of delivery.", "Product must be in original packaging.", "Damaged products are replaced immediately.", "Contact us via WhatsApp for returns."] },
};

const TERMS_CONTENT: Record<string, { title: string; body: string }> = {
  az: { title: "İstifadə Şərtləri", body: "Bu saytı istifadə etməklə aşağıdakı şərtləri qəbul edirsiniz.\n\n**1. Xidmətlərimiz**\nSaytımız Azərbaycan daxilindəki müştərilərə məhsul satışı xidməti göstərir.\n\n**2. Ödəniş**\nBütün sifarişlər 'çatdırılmada ödəniş' prinsipi ilə həyata keçirilir.\n\n**3. Çatdırılma**\nÇatdırılma yalnız Azərbaycan ərazisini əhatə edir.\n\n**4. Məxfilik**\nŞəxsi məlumatlarınız yalnız sifarişin icrasında istifadə olunur." },
  ru: { title: "Условия использования", body: "Используя этот сайт, вы принимаете следующие условия.\n\n**1. Наши услуги**\nНаш сайт предоставляет услуги по продаже товаров покупателям в Азербайджане.\n\n**2. Оплата**\nВсе заказы оплачиваются по принципу 'оплата при доставке'.\n\n**3. Доставка**\nДоставка осуществляется только по территории Азербайджана.\n\n**4. Конфиденциальность**\nВаши личные данные используются только для выполнения заказа." },
  en: { title: "Terms of Service", body: "By using this site, you agree to the following terms.\n\n**1. Our Services**\nOur site provides product sales services to customers within Azerbaijan.\n\n**2. Payment**\nAll orders are processed on a 'cash on delivery' basis.\n\n**3. Delivery**\nDelivery covers Azerbaijan territory only.\n\n**4. Privacy**\nYour personal data is used only to fulfill your order." },
};

export function DeliveryPage({ locale }: { locale: string }) {
  const page = DELIVERY_CONTENT[locale] ?? DELIVERY_CONTENT.en;
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">{page.title}</h1>
      <ul className="space-y-4">
        {page.points.map((point, i) => (
          <li key={i} className="flex items-start gap-3 text-muted-foreground">
            <span className="mt-1 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReturnsPage({ locale }: { locale: string }) {
  const page = RETURNS_CONTENT[locale] ?? RETURNS_CONTENT.en;
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">{page.title}</h1>
      <ul className="space-y-4">
        {page.points.map((point, i) => (
          <li key={i} className="flex items-start gap-3 text-muted-foreground">
            <span className="mt-1 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TermsPage({ locale }: { locale: string }) {
  const page = TERMS_CONTENT[locale] ?? TERMS_CONTENT.en;
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">{page.title}</h1>
      <div className="prose prose-sm max-w-none text-muted-foreground">
        {page.body.split("\n\n").map((para, i) => (
          <p key={i} className="mb-4">{para.replace(/\*\*/g, "")}</p>
        ))}
      </div>
    </div>
  );
}
