import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Privacy Policy" };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const titles: Record<string, string> = {
    az: "Məxfilik Siyasəti",
    ru: "Политика конфиденциальности",
    en: "Privacy Policy",
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">
        {titles[locale] ?? titles.en}
      </h1>
      <div className="space-y-6 text-muted-foreground leading-relaxed">
        <p>
          {locale === "az"
            ? "Biz sizin məlumatlarınızı qoruyuruq. Telefon nömrəniz yalnız sifarişin icrasında və bildirişlər üçün istifadə olunur."
            : locale === "ru"
            ? "Мы защищаем ваши данные. Ваш номер телефона используется только для выполнения заказов и уведомлений."
            : "We protect your data. Your phone number is used only for order fulfillment and notifications."}
        </p>
        <p>
          {locale === "az"
            ? "Məlumatlarınız üçüncü tərəflərə satılmır. Analitika məqsədilə Google Analytics istifadə olunur."
            : locale === "ru"
            ? "Ваши данные не продаются третьим лицам. Google Analytics используется для аналитики."
            : "Your data is not sold to third parties. Google Analytics is used for analytics purposes."}
        </p>
        <p>
          {locale === "az"
            ? `Əlaqə: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`
            : locale === "ru"
            ? `Контакт: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`
            : `Contact: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@store.az"}`}
        </p>
      </div>
    </div>
  );
}
