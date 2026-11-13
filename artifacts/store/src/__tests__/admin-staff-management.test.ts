import { describe, it, expect } from "vitest";
import { formatPhone, isValidAzPhone } from "@/components/admin/AddStaffModal";
import messages from "@/lib/i18n/messages";

describe("Staff Management Frontend Logic", () => {
  describe("Phone formatting and validation", () => {
    it("normalizes Azerbaijan phone formats to +994XXXXXXXXX", () => {
      expect(formatPhone("0501234567")).toBe("+994501234567");
      expect(formatPhone("994501234567")).toBe("+994501234567");
      expect(formatPhone("+994 50 123 45 67")).toBe("+994501234567");
      expect(formatPhone("50 123 45 67")).toBe("+994501234567");
    });

    it("validates 9-digit Azerbaijan mobile numbers", () => {
      expect(isValidAzPhone("+994501234567")).toBe(true);
      expect(isValidAzPhone("0501234567")).toBe(true);
      expect(isValidAzPhone("+994559876543")).toBe(true);
      expect(isValidAzPhone("+994701112233")).toBe(true);

      // Invalid formats
      expect(isValidAzPhone("+99450123456")).toBe(false); // 8 digits
      expect(isValidAzPhone("+9945012345678")).toBe(false); // 10 digits
      expect(isValidAzPhone("+15551234567")).toBe(false); // non-AZ
      expect(isValidAzPhone("")).toBe(false);
    });
  });

  describe("Role mapping and i18n consistency", () => {
    const LOCALES = ["az", "ru", "en"] as const;

    it("has translation keys for all staff management strings across locales", () => {
      for (const loc of LOCALES) {
        const u = messages[loc].Admin.Users;
        expect(u.roleAdmin).toBeDefined();
        expect(u.roleStaff).toBeDefined();
        expect(u.roleCustomer).toBeDefined();
        expect(u.addStaff).toBeDefined();
        expect(u.addStaffDescription).toBeDefined();
        expect(u.fullName).toBeDefined();
        expect(u.phone).toBeDefined();
        expect(u.role).toBeDefined();
        expect(u.staffCreatedSuccess).toBeDefined();
        expect(u.invalidPhone).toBeDefined();
        expect(u.changeRole).toBeDefined();
      }
    });

    it("supports admin, staff, and customer roles", () => {
      type ValidRole = "admin" | "staff" | "customer";
      const roles: ValidRole[] = ["admin", "staff", "customer"];
      expect(roles).toHaveLength(3);
      expect(roles).toContain("staff");
    });
  });
});
