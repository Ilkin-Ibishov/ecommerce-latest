import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { SupplierModal, type SupplierItem } from "@/components/admin/SupplierModal";

export default function SuppliersPage() {
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierItem | null>(null);

  const fetchSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminJson(apiUrl("/admin/suppliers"));
      setSuppliers(data.suppliers ?? []);
    } catch {
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("Admin.Suppliers.deleteConfirm"))) return;
    try {
      await adminJson(apiUrl(`/admin/suppliers/${id}`), { method: "DELETE" });
      fetchSuppliers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filtered = suppliers.filter((s) => {
    if (statusFilter === "active" && !s.is_active) return false;
    if (statusFilter === "inactive" && s.is_active) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = s.name.toLowerCase().includes(q);
      const matchContact = s.contact_name?.toLowerCase().includes(q);
      const matchPhone = s.phone?.toLowerCase().includes(q);
      return matchName || matchContact || matchPhone;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 size={24} className="text-primary" />
            {t("Admin.Suppliers.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("Admin.Suppliers.subtitle")}</p>
        </div>
        <button
          onClick={() => { setEditingSupplier(null); setModalOpen(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Plus size={16} />
          {t("Admin.Suppliers.addSupplier")}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Admin.Suppliers.searchPlaceholder")}
          className="px-3 py-2 text-sm bg-background border border-border rounded-lg max-w-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex gap-1 border border-border rounded-lg p-1 bg-muted/20">
          {(["all", "active", "inactive"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition ${
                statusFilter === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {key === "all" ? t("Admin.Suppliers.all") : key === "active" ? t("Admin.Suppliers.active") : t("Admin.Suppliers.inactive")}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("Admin.Common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-sm text-muted-foreground">
          {t("Admin.Suppliers.empty")}
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t("Admin.Suppliers.name")}</th>
                  <th className="px-4 py-3">{t("Admin.Suppliers.contactName")}</th>
                  <th className="px-4 py-3">{t("Admin.Suppliers.phone")}</th>
                  <th className="px-4 py-3">{t("Admin.Suppliers.email")}</th>
                  <th className="px-4 py-3">{t("Admin.Suppliers.status")}</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30 transition">
                    <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.contact_name ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{s.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full ${
                        s.is_active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                      }`}>
                        {s.is_active ? t("Admin.Suppliers.active") : t("Admin.Suppliers.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditingSupplier(s); setModalOpen(true); }}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground transition"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SupplierModal
        open={modalOpen}
        supplier={editingSupplier}
        onClose={() => setModalOpen(false)}
        onSaved={fetchSuppliers}
      />
    </div>
  );
}
