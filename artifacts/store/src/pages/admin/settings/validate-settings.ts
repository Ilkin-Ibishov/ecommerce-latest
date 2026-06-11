import type { SiteSettings } from "@/lib/settings/context";

/**
 * Validation rules for the admin settings form.
 * Returns a Record<string, string> mapping field names to error messages.
 * An empty record means the form is valid.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+]*$/;

export interface SettingsFieldLimits {
  storeNameMax: number;
  phoneMax: number;
  emailMax: number;
  addressMax: number;
  socialLinkMax: number;
  workingHoursMax: number;
  footerTextMax: number;
}

export const FIELD_LIMITS: SettingsFieldLimits = {
  storeNameMax: 100,
  phoneMax: 20,
  emailMax: 254,
  addressMax: 200,
  socialLinkMax: 255,
  workingHoursMax: 200,
  footerTextMax: 500,
};

export type ValidationErrors = Record<string, string>;

export function validateSettings(settings: SiteSettings): ValidationErrors {
  const errors: ValidationErrors = {};

  // ─── Store Name validation (max length) ─────────────────────────────────
  const storeName = settings.store_name ?? {};
  for (const locale of ["az", "ru", "en"] as const) {
    const val = storeName[locale] ?? "";
    if (val.length > FIELD_LIMITS.storeNameMax) {
      errors[`store_name_${locale}`] = `Store name (${locale.toUpperCase()}) must be ${FIELD_LIMITS.storeNameMax} characters or less`;
    }
  }

  // ─── Contact validation ─────────────────────────────────────────────────
  const contact = settings.contact ?? { phone: "", email: "", address: "", social_links: {} };

  // Phone: digits and + only
  if (contact.phone && !PHONE_REGEX.test(contact.phone)) {
    errors.phone = "Phone must contain only digits and +";
  }
  if (contact.phone && contact.phone.length > FIELD_LIMITS.phoneMax) {
    errors.phone = `Phone must be ${FIELD_LIMITS.phoneMax} characters or less`;
  }

  // Email: standard format
  if (contact.email && !EMAIL_REGEX.test(contact.email)) {
    errors.email = "Please enter a valid email address";
  }
  if (contact.email && contact.email.length > FIELD_LIMITS.emailMax) {
    errors.email = `Email must be ${FIELD_LIMITS.emailMax} characters or less`;
  }

  // Address: max length
  if (contact.address && contact.address.length > FIELD_LIMITS.addressMax) {
    errors.address = `Address must be ${FIELD_LIMITS.addressMax} characters or less`;
  }

  // Social links: must start with https:// if not empty
  const socialLinks = contact.social_links ?? {};
  for (const platform of ["instagram", "facebook", "telegram"] as const) {
    const url = socialLinks[platform] ?? "";
    if (url && !url.startsWith("https://")) {
      errors[`social_${platform}`] = `${platform.charAt(0).toUpperCase() + platform.slice(1)} URL must start with https://`;
    }
    if (url.length > FIELD_LIMITS.socialLinkMax) {
      errors[`social_${platform}`] = `${platform.charAt(0).toUpperCase() + platform.slice(1)} URL must be ${FIELD_LIMITS.socialLinkMax} characters or less`;
    }
  }

  // ─── Working Hours validation (max length) ──────────────────────────────
  const workingHours = settings.working_hours ?? {};
  for (const locale of ["az", "ru", "en"] as const) {
    const val = workingHours[locale] ?? "";
    if (val.length > FIELD_LIMITS.workingHoursMax) {
      errors[`working_hours_${locale}`] = `Working hours (${locale.toUpperCase()}) must be ${FIELD_LIMITS.workingHoursMax} characters or less`;
    }
  }

  // ─── Footer Text validation (max length) ────────────────────────────────
  const footerText = settings.footer_text ?? {};
  for (const locale of ["az", "ru", "en"] as const) {
    const val = footerText[locale] ?? "";
    if (val.length > FIELD_LIMITS.footerTextMax) {
      errors[`footer_text_${locale}`] = `Footer text (${locale.toUpperCase()}) must be ${FIELD_LIMITS.footerTextMax} characters or less`;
    }
  }

  return errors;
}

/**
 * Returns the data-field attribute value for the first error field,
 * which can be used to scroll to the element.
 */
export function getFirstErrorField(errors: ValidationErrors): string | null {
  const keys = Object.keys(errors);
  return keys.length > 0 ? keys[0] : null;
}
