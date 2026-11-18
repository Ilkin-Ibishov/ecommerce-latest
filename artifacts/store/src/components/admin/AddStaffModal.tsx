import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function formatPhone(val: string): string {
  let digits = val.replace(/\D/g, "");
  if (digits.startsWith("994")) return `+${digits}`;
  if (digits.startsWith("0")) return `+994${digits.slice(1)}`;
  if (digits.length > 0 && !digits.startsWith("9")) return `+994${digits}`;
  return digits ? `+${digits}` : "";
}

export function isValidAzPhone(phone: string): boolean {
  return /^\+994\d{9}$/.test(formatPhone(phone));
}

export function AddStaffModal({ open, onClose, onCreated }: Props) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => { setFullName(""); setPhone(""); setRole("staff"); setError(null); };
  const handleClose = () => { resetForm(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const formattedPhone = formatPhone(phone);
    if (!isValidAzPhone(formattedPhone)) {
      setError(t("Admin.Users.error.invalid_phone"));
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(apiUrl("/admin/users"), {
        method: "POST",
        body: JSON.stringify({ full_name: fullName.trim() || null, phone: formattedPhone, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errKey = data.error ? `Admin.Users.error.${data.error}` : "Admin.Common.error";
        setError(t(errKey as any) || data.error || t("Admin.Common.error"));
        return;
      }
      resetForm();
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || t("Admin.Common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("Admin.Users.addStaff")}</DialogTitle>
          <p className="text-xs text-muted-foreground">{t("Admin.Users.addStaffDescription")}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-3 rounded-lg">{error}</div>}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{t("Admin.Users.fullName")}</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Əli Məmmədov"
              className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              {t("Admin.Users.phone")} <span className="text-destructive">*</span>
            </label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+994 50 123 45 67"
              className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{t("Admin.Users.role")}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "staff" | "admin")}
              className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="staff">{t("Admin.Users.roleStaff")}</option>
              <option value="admin">{t("Admin.Users.roleAdmin")}</option>
            </select>
          </div>
          <DialogFooter className="pt-2 gap-2">
            <button type="button" onClick={handleClose} disabled={saving} className="px-4 py-2 text-xs font-medium rounded-lg border border-input bg-card hover:bg-muted transition">
              {t("Admin.Common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50">
              {saving ? t("Admin.Users.submitting") : t("Admin.Users.addStaff")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
