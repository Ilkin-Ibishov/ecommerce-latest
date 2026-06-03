import { Link } from "wouter";
import { Phone, MapPin, Mail, Instagram, Facebook, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export default function StorefrontFooter({ locale }: { locale: string }) {
  const { t } = useI18n();
  const storeName = import.meta.env.VITE_STORE_NAME ?? "İlk Electronics";
  return (
    <footer className="border-t border-gray-800 bg-gray-950 text-gray-400 mt-8 mb-16 md:mb-0">
      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <img src="/logo.png" alt={storeName} className="h-12 w-auto object-contain mb-4" />
            <p className="text-sm text-gray-500 leading-relaxed">
              {t("Footer.brandDescription")}
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="https://instagram.com" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-pink-600 hover:text-white flex items-center justify-center transition">
                <Instagram size={15} />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-blue-600 hover:text-white flex items-center justify-center transition">
                <Facebook size={15} />
              </a>
              <a href="https://t.me" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-sky-500 hover:text-white flex items-center justify-center transition">
                <Send size={15} />
              </a>
            </div>
          </div>

          {/* Shop column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">{t("Footer.store")}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={`/${locale}/products`} className="hover:text-yellow-400 transition">{t("Footer.allProducts")}</Link></li>
              <li><Link href={`/${locale}/categories`} className="hover:text-yellow-400 transition">{t("Footer.categories")}</Link></li>
              <li><Link href={`/${locale}/products?sale=true`} className="hover:text-yellow-400 transition">{t("Footer.discountedProducts")}</Link></li>
              <li><Link href={`/${locale}/products?deal=true`} className="hover:text-yellow-400 transition">{t("Footer.dealOfDay")}</Link></li>
            </ul>
          </div>

          {/* Info column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">{t("Footer.info")}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={`/${locale}/policies/delivery`} className="hover:text-yellow-400 transition">{t("Footer.deliveryTerms")}</Link></li>
              <li><Link href={`/${locale}/policies/returns`} className="hover:text-yellow-400 transition">{t("Footer.returns")}</Link></li>
              <li><Link href={`/${locale}/policies/terms`} className="hover:text-yellow-400 transition">{t("Footer.termsOfUse")}</Link></li>
            </ul>
          </div>

          {/* Contact column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">{t("Footer.contact")}</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <Phone size={14} className="mt-0.5 shrink-0 text-yellow-500" />
                <span>+994 55 619 59 07</span>
              </li>
              <li className="flex items-start gap-2">
                <Mail size={14} className="mt-0.5 shrink-0 text-yellow-500" />
                <span>info@ilkelectronics.com</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 shrink-0 text-yellow-500" />
                <span>Bakı, Azərbaycan</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
          <span>© {new Date().getFullYear()} {storeName}. {t("Footer.allRightsReserved")}</span>
          <span>{t("Footer.paymentOnDelivery")}</span>
        </div>
      </div>
    </footer>
  );
}
