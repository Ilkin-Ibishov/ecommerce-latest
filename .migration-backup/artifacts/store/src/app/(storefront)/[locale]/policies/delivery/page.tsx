import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Delivery Info" };
}

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const content: Record<string, { title: string; points: string[] }> = {
    az: {
      title: "Çatdırılma Məlumatı",
      points: [
        "Çatdırılma yalnız Azərbaycan ərazisini əhatə edir.",
        "Çatdırılma müddəti: adətən 1-3 iş günü.",
        "Ödəniş çatdırılma zamanı nağd şəkildə həyata keçirilir (AZN).",
        "Minimum sifariş məbləği yoxdur.",
        "Çatdırılma haqqı sabit tariflə hesablanır.",
        "Sifarişin statusunu WhatsApp vasitəsilə izləmək olar.",
      ],
    },
    ru: {
      title: "Информация о доставке",
      points: [
        "Доставка осуществляется только по территории Азербайджана.",
        "Срок доставки: обычно 1-3 рабочих дня.",
        "Оплата производится наличными при доставке (AZN).",
        "Минимальная сумма заказа отсутствует.",
        "Стоимость доставки рассчитывается по фиксированному тарифу.",
        "Статус заказа можно отслеживать через WhatsApp.",
      ],
    },
    en: {
      title: "Delivery Information",
      points: [
        "Delivery covers Azerbaijan territory only.",
        "Delivery time: usually 1-3 business days.",
        "Payment is made in cash upon delivery (AZN).",
        "No minimum order amount.",
        "Delivery fee is calculated at a flat rate.",
        "Order status can be tracked via WhatsApp.",
      ],
    },
  };

  const page = content[locale] ?? content.en;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">{page.title}</h1>
      <ul className="space-y-4">
        {page.points.map((point, i) => (
          <li key={i} className="flex items-start gap-3 text-muted-foreground">
            <span className="mt-1 w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {i + 1}
            </span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}
