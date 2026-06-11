import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Phone, MapPin, Mail, Instagram, Facebook, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useSettings } from "@/lib/settings/context";
import { apiUrl } from "@/lib/api";

interface FooterPage {
  id: string;
  slug: string;
  title: string;
  show_in_footer: boolean;
  sort_order: number;
}

export default function StorefrontFooter({ locale }: { locale: string }) {
  const { t } = useI18n();
  const { settings, getStoreName, getWorkingHours, getFooterText } = useSettings();
  const [footerPages, setFooterPages] = useState<FooterPage[]>([]);

  const storeName = getStoreName(locale);
  const workingHours = getWorkingHours(locale);
  const footerText = getFooterText(locale);

  // Fetch footer pages (published pages with show_in_footer = true)
  useEffect(() => {
    fetch(apiUrl(`/pages?locale=${locale}`))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((pages: FooterPage[]) => {
        const filtered = pages
          .filter((p) => p.show_in_footer)
          .sort((a, b) => a.sort_order - b.sort_order);
        setFooterPages(filtered);
      })
      .catch(() => {
        // Silently fail — footer pages are non-critical
        setFooterPages([]);
      });
  }, [locale]);

  // Contact fields — only render if non-null, non-empty
  const phone = settings.contact?.phone || "";
  const email = settings.contact?.email || "";
  const address = settings.contact?.address || "";

  // Social links — only render non-empty URLs starting with https://
  const socialLinks = settings.contact?.social_links ?? {};
  const instagramUrl = socialLinks.instagram && socialLinks.instagram.startsWith("https://") ? socialLinks.instagram : null;
  const facebookUrl = socialLinks.facebook && socialLinks.facebook.startsWith("https://") ? socialLinks.facebook : null;
  const telegramUrl = socialLinks.telegram && socialLinks.telegram.startsWith("https://") ? socialLinks.telegram : null;
  const hasSocialLinks = instagramUrl || facebookUrl || telegramUrl;

  // Logo
  const logoUrl = settings.logo_url;

  return (
    <footer className="border-t border-border bg-secondary text-muted-foreground mt-8 mb-16 md:mb-0">
      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            {logoUrl ? (
              <img src={logoUrl} alt={storeName} className="h-12 w-auto object-contain mb-4" />
            ) : (
              <p className="text-lg font-semibold text-foreground mb-4">{storeName}</p>
            )}
            {footerText && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {footerText}
              </p>
            )}
            {!footerText && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("Footer.brandDescription")}
              </p>
            )}
            {hasSocialLinks && (
              <div className="flex items-center gap-3 mt-4">
                {instagramUrl && (
                  <a href={instagramUrl} target="_blank" rel="noreferrer"
                    className="w-8 h-8 rounded-lg bg-muted hover:bg-primary hover:text-primary-foreground flex items-center justify-center transition">
                    <Instagram size={15} />
                  </a>
                )}
                {facebookUrl && (
                  <a href={facebookUrl} target="_blank" rel="noreferrer"
                    className="w-8 h-8 rounded-lg bg-muted hover:bg-primary hover:text-primary-foreground flex items-center justify-center transition">
                    <Facebook size={15} />
                  </a>
                )}
                {telegramUrl && (
                  <a href={telegramUrl} target="_blank" rel="noreferrer"
                    className="w-8 h-8 rounded-lg bg-muted hover:bg-primary hover:text-primary-foreground flex items-center justify-center transition">
                    <Send size={15} />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Shop column */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-foreground">{t("Footer.store")}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={`/${locale}/products`} className="hover:text-primary transition">{t("Footer.allProducts")}</Link></li>
              <li><Link href={`/${locale}/categories`} className="hover:text-primary transition">{t("Footer.categories")}</Link></li>
              <li><Link href={`/${locale}/products?sale=true`} className="hover:text-primary transition">{t("Footer.discountedProducts")}</Link></li>
              <li><Link href={`/${locale}/products?deal=true`} className="hover:text-primary transition">{t("Footer.dealOfDay")}</Link></li>
            </ul>
          </div>

          {/* Info column — dynamically generated from pages with show_in_footer */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-foreground">{t("Footer.info")}</h4>
            <ul className="space-y-2 text-sm">
              {footerPages.map((page) => (
                <li key={page.id}>
                  <Link href={`/${locale}/page/${page.slug}`} className="hover:text-primary transition">
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact column — omit empty fields */}
          <div>
            <h4 className="font-semibold mb-3 text-sm text-foreground">{t("Footer.contact")}</h4>
            <ul className="space-y-3 text-sm">
              {phone && (
                <li className="flex items-start gap-2">
                  <Phone size={14} className="mt-0.5 shrink-0 text-primary" />
                  <span>{phone}</span>
                </li>
              )}
              {email && (
                <li className="flex items-start gap-2">
                  <Mail size={14} className="mt-0.5 shrink-0 text-primary" />
                  <span>{email}</span>
                </li>
              )}
              {address && (
                <li className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-primary" />
                  <span>{address}</span>
                </li>
              )}
            </ul>
            {workingHours && (
              <p className="text-sm text-muted-foreground mt-3">{workingHours}</p>
            )}
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} {storeName}. {t("Footer.allRightsReserved")}</span>
          <span>{t("Footer.paymentOnDelivery")}</span>
        </div>
      </div>
    </footer>
  );
}
