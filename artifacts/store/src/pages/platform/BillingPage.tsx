/**
 * Platform Billing Page — invoice list + mark-paid for a selected store.
 *
 * Feature: super-admin-platform
 * Requirements: 6.10
 *
 * Shows invoices for a selected store via GET /api/platform/stores/:id/invoices.
 * Mark-paid button calls POST /api/platform/invoices/:id/pay.
 * All strings via useI18n() t(key) for az/ru/en.
 */
import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreOption {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  period_from: string;
  period_to: string;
  issued_at: string;
  due_at: string;
  amount: string;
  status: "open" | "paid" | "void";
  paid_at: string | null;
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  open: "bg-yellow-100 text-yellow-800",
  void: "bg-gray-100 text-gray-600",
};

function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const { t } = useI18n();

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [storesLoading, setStoresLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  // Fetch stores for the dropdown
  useEffect(() => {
    const controller = new AbortController();
    setStoresLoading(true);

    fetch(apiUrl("/platform/stores?pageSize=200"), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch stores (${res.status})`);
        return res.json();
      })
      .then((json) => {
        const list = (json.data as StoreOption[]).map((s) => ({
          id: s.id,
          name: s.name,
        }));
        setStores(list);
        setStoresLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setStoresLoading(false);
        setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => controller.abort();
  }, []);

  // Fetch invoices when a store is selected
  const fetchInvoices = useCallback(
    async (storeId: string) => {
      if (!storeId) {
        setInvoices([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/platform/stores/${storeId}/invoices`));
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const json = await res.json();
        setInvoices(json.data as Invoice[]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setInvoices([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedStoreId) {
      fetchInvoices(selectedStoreId);
    } else {
      setInvoices([]);
    }
  }, [selectedStoreId, fetchInvoices]);

  // Mark invoice as paid
  const handleMarkPaid = async (invoiceId: string) => {
    setMarkingPaidId(invoiceId);
    try {
      const res = await fetch(apiUrl(`/platform/invoices/${invoiceId}/pay`), {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Mark paid failed (${res.status})`);
      }
      // Refresh invoices
      await fetchInvoices(selectedStoreId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setMarkingPaidId(null);
    }
  };

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedStoreId(e.target.value);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold">{t("Platform.billing.title")}</h1>

      {/* Store selector */}
      <div className="flex flex-col gap-1 max-w-sm">
        <label htmlFor="billing-store-select" className="text-sm text-muted-foreground">
          {t("Platform.billing.selectStore")}
        </label>
        <select
          id="billing-store-select"
          value={selectedStoreId}
          onChange={handleStoreChange}
          disabled={storesLoading}
          className="border border-border rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t("Platform.billing.selectStore")}
        >
          <option value="">{t("Platform.billing.selectStorePlaceholder")}</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="text-destructive text-sm">{error}</div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-muted-foreground text-sm">{t("Platform.billing.loading")}</div>
      )}

      {/* Invoice table */}
      {selectedStoreId && !loading && (
        <>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("Platform.billing.noInvoices")}</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.period")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.issueDate")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.dueDate")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      {t("Platform.billing.amount")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.status")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.paidAt")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {t("Platform.billing.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-border">
                      <td className="px-4 py-2">
                        {invoice.period_from} — {invoice.period_to}
                      </td>
                      <td className="px-4 py-2">{invoice.issued_at}</td>
                      <td className="px-4 py-2">{invoice.due_at}</td>
                      <td className="px-4 py-2 text-right font-medium">
                        ${invoice.amount}
                      </td>
                      <td className="px-4 py-2">
                        <InvoiceStatusBadge status={invoice.status} />
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {invoice.paid_at ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {invoice.status === "open" && (
                          <button
                            onClick={() => handleMarkPaid(invoice.id)}
                            disabled={markingPaidId === invoice.id}
                            className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            aria-label={`${t("Platform.billing.markPaid")} — ${invoice.period_from} to ${invoice.period_to}`}
                          >
                            {markingPaidId === invoice.id
                              ? t("Platform.billing.marking")
                              : t("Platform.billing.markPaid")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Prompt to select a store */}
      {!selectedStoreId && !loading && !storesLoading && (
        <p className="text-muted-foreground text-sm">{t("Platform.billing.selectPrompt")}</p>
      )}
    </div>
  );
}
