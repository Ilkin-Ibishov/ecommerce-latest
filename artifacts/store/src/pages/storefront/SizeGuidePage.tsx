import { useState } from "react";
import { Link } from "wouter";
import { Ruler, Shirt, Footprints } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const CLOTHING_SIZES = [
  { size: "XS", chest: "84-88", waist: "68-72", hips: "88-92" },
  { size: "S", chest: "88-92", waist: "72-76", hips: "92-96" },
  { size: "M", chest: "92-96", waist: "76-80", hips: "96-100" },
  { size: "L", chest: "96-102", waist: "80-86", hips: "100-106" },
  { size: "XL", chest: "102-108", waist: "86-92", hips: "106-112" },
  { size: "XXL", chest: "108-114", waist: "92-98", hips: "112-118" },
];

const SHOE_SIZES = [
  { eu: "36", us: "5.5", uk: "3.5", cm: "23.0" },
  { eu: "37", us: "6.0", uk: "4.0", cm: "23.5" },
  { eu: "38", us: "6.5", uk: "4.5", cm: "24.0" },
  { eu: "39", us: "7.0", uk: "5.0", cm: "24.5" },
  { eu: "40", us: "7.5", uk: "5.5", cm: "25.0" },
  { eu: "41", us: "8.5", uk: "6.5", cm: "26.0" },
  { eu: "42", us: "9.0", uk: "7.0", cm: "26.5" },
  { eu: "43", us: "10.0", uk: "8.0", cm: "27.5" },
  { eu: "44", us: "10.5", uk: "8.5", cm: "28.0" },
  { eu: "45", us: "11.5", uk: "9.5", cm: "29.0" },
];

export default function SizeGuidePage({ locale }: { locale: string }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"clothing" | "shoes">("clothing");

  const isAz = locale === "az";
  const isRu = locale === "ru";

  const clothingTabLabel = isAz ? "Geyim" : isRu ? "Одежда" : "Clothing";
  const shoesTabLabel = isAz ? "Ayaqqabı" : isRu ? "Обувь" : "Shoes";
  const guideTitle = t("SizeGuide.header") || (isAz ? "Ölçü Cədvəli" : isRu ? "Таблица размеров" : "Size Guide");
  const homeLabel = isAz ? "Ana səhifə" : isRu ? "Главная" : "Home";

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-1.5" aria-label="Breadcrumb">
        <Link href={`/${locale}`} className="hover:text-foreground transition">{homeLabel}</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{guideTitle}</span>
      </nav>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Ruler size={22} />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{guideTitle}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAz ? "Düzgün ölçü seçmək üçün standart parametrlər" : isRu ? "Стандартные параметры для выбора размера" : "Standard reference measurements for choosing your size"}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-3 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab("clothing")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === "clothing"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Shirt size={16} />
          {clothingTabLabel}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("shoes")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === "shoes"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Footprints size={16} />
          {shoesTabLabel}
        </button>
      </div>

      {/* Tables */}
      {activeTab === "clothing" ? (
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                  <th className="py-3 px-4">{isAz ? "Ölçü" : isRu ? "Размер" : "Size"}</th>
                  <th className="py-3 px-4">{isAz ? "Sinə (sm)" : isRu ? "Грудь (см)" : "Chest (cm)"}</th>
                  <th className="py-3 px-4">{isAz ? "Bel (sm)" : isRu ? "Талия (см)" : "Waist (cm)"}</th>
                  <th className="py-3 px-4">{isAz ? "Omba (sm)" : isRu ? "Бёдра (см)" : "Hips (cm)"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CLOTHING_SIZES.map((row) => (
                  <tr key={row.size} className="hover:bg-muted/30 transition">
                    <td className="py-3 px-4 font-bold text-foreground">{row.size}</td>
                    <td className="py-3 px-4">{row.chest}</td>
                    <td className="py-3 px-4">{row.waist}</td>
                    <td className="py-3 px-4">{row.hips}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                  <th className="py-3 px-4">EU</th>
                  <th className="py-3 px-4">US</th>
                  <th className="py-3 px-4">UK</th>
                  <th className="py-3 px-4">CM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SHOE_SIZES.map((row) => (
                  <tr key={row.eu} className="hover:bg-muted/30 transition">
                    <td className="py-3 px-4 font-bold text-foreground">{row.eu}</td>
                    <td className="py-3 px-4">{row.us}</td>
                    <td className="py-3 px-4">{row.uk}</td>
                    <td className="py-3 px-4">{row.cm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Measuring tips */}
      <div className="mt-8 bg-muted/40 border border-border rounded-xl p-4 sm:p-5 text-sm text-muted-foreground leading-relaxed">
        <h2 className="font-semibold text-foreground mb-2">
          {isAz ? "💡 Düzgün ölçmə qaydası" : isRu ? "💡 Как правильно снять мерки" : "💡 How to measure"}
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>{isAz ? "Sinə / Grud:" : isRu ? "Грудь:" : "Chest:"}</strong>{" "}
            {isAz ? "Ölçü lentini sinənin ən qabarıq nöqtəsindən üfüqi keçirin." : isRu ? "Измеряется по наиболее выступающим точкам груди." : "Measure horizontally across the fullest part of the chest."}
          </li>
          <li>
            <strong>{isAz ? "Bel / Taliya:" : isRu ? "Талия:" : "Waist:"}</strong>{" "}
            {isAz ? "Təbii bel xətti boyunca ölçün." : isRu ? "Измеряется по самой узкой линии талии." : "Measure around the natural waistline."}
          </li>
          <li>
            <strong>{isAz ? "Omba / Bëdra:" : isRu ? "Бёдра:" : "Hips:"}</strong>{" "}
            {isAz ? "Ombanın ən çıxıntılı yerindən ölçün." : isRu ? "Измеряется по наиболее выступающим точкам ягодиц." : "Measure around the fullest part of the hips."}
          </li>
        </ul>
      </div>
    </div>
  );
}
