import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";

export interface SupplierItem {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

interface SupplierModalProps {
  open: boolean;
  supplier: SupplierItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SupplierModal({ open, supplier, onClose, onSaved }: SupplierModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supplier) {
      setName(supplier.name);
      setContactName(supplier.contact_name ?? "");
      setPhone(supplier.phone ?? "");
      setEmail(supplier.email ?? "");
      setAddress(supplier.address ?? "");
      setNotes(supplier.notes ?? "");
      setIsActive(supplier.is_active);
    } else {
      setName(""); setContactName(""); setPhone("");
      setEmail(""); setAddress(""); setNotes(""); setIsActive(true);
    }
    setError(null);
  }, [supplier, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      is_active: isActive,
    };
    try {
      const url = supplier ? `/admin/suppliers/${supplier.id}` : "/admin/suppliers";
      await adminJson(apiUrl(url), {
        method: supplier ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <h3 className="font-semibold text-foreground">
            {supplier ? t("Admin.Suppliers.editSupplier") : t("Admin.Suppliers.addSupplier")}
          </h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:bg-muted transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Suppliers.name")} *</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Suppliers.contactName")}</label>
              <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Suppliers.phone")}</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Suppliers.email")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Admin.Suppliers.address")}</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input type="checkbox" id="is_active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary" />
            <label htmlFor="is_active" className="text-xs font-medium cursor-pointer">{t("Admin.Suppliers.active")}</label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted">
              {t("Admin.Common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
              {saving ? t("Admin.Common.saving") : t("Admin.Common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
