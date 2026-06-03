import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Terms of Service" };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const content: Record<string, { title: string; body: string }> = {
    az: {
      title: "İstifadə Şərtləri",
      body: `Bu saytı istifadə etməklə aşağıdakı şərtləri qəbul edirsiniz.

**1. Xidmətlərimiz**
Saytımız Azərbaycan daxilindəki müştərilərə məhsul satışı xidməti göstərir. Bütün ödənişlər AZN valyutasında həyata keçirilir.

**2. Ödəniş**
Bütün sifarişlər "çatdırılmada ödəniş" prinsipi ilə həyata keçirilir. Kart ödənişi qəbul edilmir.

**3. Çatdırılma**
Çatdırılma yalnız Azərbaycan ərazisini əhatə edir.

**4. Məxfilik**
Şəxsi məlumatlarınız yalnız sifarişin icrasında istifadə olunur.

**5. Əlaqə**
Suallarınız üçün: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`,
    },
    ru: {
      title: "Условия использования",
      body: `Используя этот сайт, вы принимаете следующие условия.

**1. Наши услуги**
Наш сайт предоставляет услуги по продаже товаров покупателям в Азербайджане. Все платежи осуществляются в валюте AZN.

**2. Оплата**
Все заказы оплачиваются по принципу «оплата при доставке». Оплата картой не принимается.

**3. Доставка**
Доставка осуществляется только по территории Азербайджана.

**4. Конфиденциальность**
Ваши личные данные используются только для выполнения заказа.

**5. Контакт**
По вопросам: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`,
    },
    en: {
      title: "Terms of Service",
      body: `By using this site, you agree to the following terms.

**1. Our Services**
Our site provides product sales services to customers within Azerbaijan. All payments are made in AZN currency.

**2. Payment**
All orders are processed on a "pay on delivery" basis. Card payments are not accepted.

**3. Delivery**
Delivery covers Azerbaijan territory only.

**4. Privacy**
Your personal data is used only for order fulfillment.

**5. Contact**
For questions: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`,
    },
  };

  const page = content[locale] ?? content.en;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">{page.title}</h1>
      <div className="prose prose-neutral max-w-none space-y-4">
        {page.body.split("\n\n").map((para, i) => (
          <p key={i} className="text-muted-foreground leading-relaxed whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}
