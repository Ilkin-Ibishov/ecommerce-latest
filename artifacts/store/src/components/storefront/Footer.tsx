import { Link } from "wouter";
import { Phone, MapPin, Mail, Instagram, Facebook, Send } from "lucide-react";

export default function StorefrontFooter({ locale }: { locale: string }) {
  const storeName = import.meta.env.VITE_STORE_NAME ?? "İlk Electronics";
  return (
    <footer className="border-t border-border bg-gray-950 text-gray-300 mt-8 mb-16 md:mb-0">
      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="bg-gray-900 rounded-lg px-3 py-2 inline-flex mb-4">
              <img src="/logo.jpg" alt={storeName} className="h-8 w-auto object-contain" />
            </div>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Azərbaycanda keyfiyyətli elektronika məhsullarının etibarlı ünvanı.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="https://instagram.com" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-pink-600 flex items-center justify-center transition">
                <Instagram size={15} />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-blue-600 flex items-center justify-center transition">
                <Facebook size={15} />
              </a>
              <a href="https://t.me" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-sky-500 flex items-center justify-center transition">
                <Send size={15} />
              </a>
            </div>
          </div>

          {/* Shop column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">Mağaza</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={`/${locale}/products`} className="hover:text-white transition">Bütün məhsullar</Link></li>
              <li><Link href={`/${locale}/categories`} className="hover:text-white transition">Kateqoriyalar</Link></li>
              <li><Link href={`/${locale}/products?sale=true`} className="hover:text-white transition">Endirimli məhsullar</Link></li>
              <li><Link href={`/${locale}/products?deal=true`} className="hover:text-white transition">Günün təklifi</Link></li>
            </ul>
          </div>

          {/* Info column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">Məlumat</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={`/${locale}/policies/delivery`} className="hover:text-white transition">Çatdırılma şərtləri</Link></li>
              <li><Link href={`/${locale}/policies/returns`} className="hover:text-white transition">Geri qaytarma</Link></li>
              <li><Link href={`/${locale}/policies/terms`} className="hover:text-white transition">İstifadə şərtləri</Link></li>
            </ul>
          </div>

          {/* Contact column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-white">Əlaqə</h4>
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

        <div className="border-t border-gray-800 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <span>© {new Date().getFullYear()} {storeName}. Bütün hüquqlar qorunur.</span>
          <span>Ödəniş çatdırılmada · Yalnız Azərbaycan</span>
        </div>
      </div>
    </footer>
  );
}
