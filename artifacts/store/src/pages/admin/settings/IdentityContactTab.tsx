import type { SiteSettings, ContactInfo } from "@/lib/settings/context";
import type { ValidationErrors } from "./validate-settings";

interface IdentityContactTabProps {
  settings: SiteSettings;
  onChange: (updates: Partial<SiteSettings>) => void;
  errors?: ValidationErrors;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-base border-b border-border pb-2">{title}</h3>
      {children}
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, maxLength, type = "text", error, fieldId }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength: number;
  type?: string;
  error?: string;
  fieldId?: string;
}) {
  return (
    <div className="space-y-1" data-field={fieldId}>
      <label className="block text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
          error ? "border-destructive" : "border-border"
        }`}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <p className="text-xs text-muted-foreground text-right">{value.length}/{maxLength}</p>
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder, maxLength, rows = 3, error, fieldId }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength: number;
  rows?: number;
  error?: string;
  fieldId?: string;
}) {
  return (
    <div className="space-y-1" data-field={fieldId}>
      <label className="block text-sm font-medium">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className={`w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y ${
          error ? "border-destructive" : "border-border"
        }`}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <p className="text-xs text-muted-foreground text-right">{value.length}/{maxLength}</p>
    </div>
  );
}

export default function IdentityContactTab({ settings, onChange, errors = {} }: IdentityContactTabProps) {
  const storeName = settings.store_name ?? { az: "", ru: "", en: "" };
  const contact = settings.contact ?? { phone: "", email: "", address: "", social_links: {} };
  const workingHours = settings.working_hours ?? { az: "", ru: "", en: "" };
  const footerText = settings.footer_text ?? { az: "", ru: "", en: "" };

  const updateStoreName = (locale: string, value: string) => {
    onChange({ store_name: { ...storeName, [locale]: value } });
  };

  const updateContact = (field: keyof Omit<ContactInfo, "social_links">, value: string) => {
    onChange({ contact: { ...contact, [field]: value } });
  };

  const updateSocialLink = (platform: "instagram" | "facebook" | "telegram", value: string) => {
    onChange({
      contact: {
        ...contact,
        social_links: { ...contact.social_links, [platform]: value },
      },
    });
  };

  const updateWorkingHours = (locale: string, value: string) => {
    onChange({ working_hours: { ...workingHours, [locale]: value } });
  };

  const updateFooterText = (locale: string, value: string) => {
    onChange({ footer_text: { ...footerText, [locale]: value } });
  };

  return (
    <div className="space-y-6">
      {/* Store Name */}
      <SectionCard title="Store Name">
        <InputField
          label="Store Name (AZ)"
          value={storeName.az ?? ""}
          onChange={(v) => updateStoreName("az", v)}
          placeholder="Mağaza adı (Azərbaycan)"
          maxLength={100}
          error={errors.store_name_az}
          fieldId="store_name_az"
        />
        <InputField
          label="Store Name (RU)"
          value={storeName.ru ?? ""}
          onChange={(v) => updateStoreName("ru", v)}
          placeholder="Название магазина (Русский)"
          maxLength={100}
          error={errors.store_name_ru}
          fieldId="store_name_ru"
        />
        <InputField
          label="Store Name (EN)"
          value={storeName.en ?? ""}
          onChange={(v) => updateStoreName("en", v)}
          placeholder="Store name (English)"
          maxLength={100}
          error={errors.store_name_en}
          fieldId="store_name_en"
        />
      </SectionCard>

      {/* Contact Information */}
      <SectionCard title="Contact Information">
        <div className="grid sm:grid-cols-2 gap-4">
          <InputField
            label="Phone"
            value={contact.phone ?? ""}
            onChange={(v) => updateContact("phone", v)}
            placeholder="+994 XX XXX XX XX"
            maxLength={20}
            type="tel"
            error={errors.phone}
            fieldId="phone"
          />
          <InputField
            label="Email"
            value={contact.email ?? ""}
            onChange={(v) => updateContact("email", v)}
            placeholder="info@example.com"
            maxLength={254}
            type="email"
            error={errors.email}
            fieldId="email"
          />
        </div>
        <InputField
          label="Address"
          value={contact.address ?? ""}
          onChange={(v) => updateContact("address", v)}
          placeholder="Bakı, Azərbaycan"
          maxLength={200}
          error={errors.address}
          fieldId="address"
        />
      </SectionCard>

      {/* Social Links */}
      <SectionCard title="Social Links">
        <InputField
          label="Instagram URL"
          value={contact.social_links?.instagram ?? ""}
          onChange={(v) => updateSocialLink("instagram", v)}
          placeholder="https://instagram.com/yourpage"
          maxLength={255}
          type="url"
          error={errors.social_instagram}
          fieldId="social_instagram"
        />
        <InputField
          label="Facebook URL"
          value={contact.social_links?.facebook ?? ""}
          onChange={(v) => updateSocialLink("facebook", v)}
          placeholder="https://facebook.com/yourpage"
          maxLength={255}
          type="url"
          error={errors.social_facebook}
          fieldId="social_facebook"
        />
        <InputField
          label="Telegram URL"
          value={contact.social_links?.telegram ?? ""}
          onChange={(v) => updateSocialLink("telegram", v)}
          placeholder="https://t.me/yourchannel"
          maxLength={255}
          type="url"
          error={errors.social_telegram}
          fieldId="social_telegram"
        />
      </SectionCard>

      {/* Working Hours */}
      <SectionCard title="Working Hours">
        <TextAreaField
          label="Working Hours (AZ)"
          value={workingHours.az ?? ""}
          onChange={(v) => updateWorkingHours("az", v)}
          placeholder="Bazar ertəsi - Şənbə: 09:00 - 18:00"
          maxLength={200}
          rows={2}
          error={errors.working_hours_az}
          fieldId="working_hours_az"
        />
        <TextAreaField
          label="Working Hours (RU)"
          value={workingHours.ru ?? ""}
          onChange={(v) => updateWorkingHours("ru", v)}
          placeholder="Понедельник - Суббота: 09:00 - 18:00"
          maxLength={200}
          rows={2}
          error={errors.working_hours_ru}
          fieldId="working_hours_ru"
        />
        <TextAreaField
          label="Working Hours (EN)"
          value={workingHours.en ?? ""}
          onChange={(v) => updateWorkingHours("en", v)}
          placeholder="Monday - Saturday: 09:00 - 18:00"
          maxLength={200}
          rows={2}
          error={errors.working_hours_en}
          fieldId="working_hours_en"
        />
      </SectionCard>

      {/* Footer Text */}
      <SectionCard title="Footer Text">
        <TextAreaField
          label="Footer Text (AZ)"
          value={footerText.az ?? ""}
          onChange={(v) => updateFooterText("az", v)}
          placeholder="Mağaza haqqında qısa məlumat..."
          maxLength={500}
          rows={3}
          error={errors.footer_text_az}
          fieldId="footer_text_az"
        />
        <TextAreaField
          label="Footer Text (RU)"
          value={footerText.ru ?? ""}
          onChange={(v) => updateFooterText("ru", v)}
          placeholder="Краткая информация о магазине..."
          maxLength={500}
          rows={3}
          error={errors.footer_text_ru}
          fieldId="footer_text_ru"
        />
        <TextAreaField
          label="Footer Text (EN)"
          value={footerText.en ?? ""}
          onChange={(v) => updateFooterText("en", v)}
          placeholder="Brief information about the store..."
          maxLength={500}
          rows={3}
          error={errors.footer_text_en}
          fieldId="footer_text_en"
        />
      </SectionCard>
    </div>
  );
}
