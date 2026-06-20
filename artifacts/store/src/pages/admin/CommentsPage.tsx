import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { getTranslatedField } from "@/lib/utils";

export default function AdminCommentsPage() {
  const { t } = useI18n();
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("comments")
      .select("*, users(full_name, phone), products(slug, product_translations(lang_code, title))")
      .order("created_at", { ascending: false })
      .then(({ data }) => { setComments(data ?? []); setLoading(false); });
  }, []);

  const approve = async (id: string, approved: boolean) => {
    await adminFetch(apiUrl(`/admin/comments/${id}`), { method: "PATCH", body: JSON.stringify({ approved }) });
    setComments((prev) => prev.map((c) => c.id === id ? { ...c, approved } : c));
    // Remove from selection if it was selected and just got approved
    if (approved) {
      setSelectedComments((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const remove = async (id: string) => {
    await adminFetch(apiUrl(`/admin/comments/${id}`), { method: "DELETE" });
    setComments((prev) => prev.filter((c) => c.id !== id));
    setSelectedComments((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkApprove = async () => {
    const ids = [...selectedComments];
    for (const id of ids) {
      await adminFetch(apiUrl(`/admin/comments/${id}`), {
        method: "PATCH",
        body: JSON.stringify({ approved: true }),
      });
    }
    setComments((prev) => prev.map((c) => selectedComments.has(c.id) ? { ...c, approved: true } : c));
    setSelectedComments(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pending = comments.filter((c) => !c.approved);
  const approved = comments.filter((c) => c.approved);

  if (loading) return <div className="text-muted-foreground">{t("Admin.Common.loading")}</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("Admin.Comments.title")}</h1>
        {selectedComments.size > 0 && (
          <button
            onClick={handleBulkApprove}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-medium hover:bg-green-600 transition"
          >
            <CheckCircle size={14} />
            {t("Admin.Comments.approveSelected").replace("{count}", String(selectedComments.size))}
          </button>
        )}
      </div>
      <Section
        title={`${t("Admin.Comments.tabPending")} (${pending.length})`}
        comments={pending}
        onApprove={approve}
        onDelete={(id) => setDeleteTarget(id)}
        selectedComments={selectedComments}
        onToggleSelect={toggleSelect}
        showCheckboxes
        emptyMessage={t("Admin.Comments.emptyPending")}
        approveTitle={t("Admin.Comments.approve")}
        unapproveTitle={t("Admin.Comments.unapprove")}
        deleteTitle={t("Admin.Comments.delete")}
        anonymousLabel={t("Admin.Comments.anonymous")}
        unknownProductLabel={t("Admin.Comments.unknownProduct")}
      />
      <Section
        title={`${t("Admin.Comments.tabApproved")} (${approved.length})`}
        comments={approved}
        onApprove={approve}
        onDelete={(id) => setDeleteTarget(id)}
        emptyMessage={t("Admin.Comments.emptyApproved")}
        approveTitle={t("Admin.Comments.approve")}
        unapproveTitle={t("Admin.Comments.unapprove")}
        deleteTitle={t("Admin.Comments.delete")}
        anonymousLabel={t("Admin.Comments.anonymous")}
        unknownProductLabel={t("Admin.Comments.unknownProduct")}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("Admin.Comments.deleteTitle")}
        message={t("Admin.Comments.deleteMessage")}
        confirmLabel={t("Admin.Comments.delete")}
        cancelLabel={t("Admin.Common.cancel")}
        destructive
        onConfirm={() => {
          if (deleteTarget) remove(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function Section({ title, comments, onApprove, onDelete, selectedComments, onToggleSelect, showCheckboxes, emptyMessage, approveTitle, unapproveTitle, deleteTitle, anonymousLabel, unknownProductLabel }: {
  title: string; comments: any[];
  onApprove: (id: string, approved: boolean) => void;
  onDelete: (id: string) => void;
  selectedComments?: Set<string>;
  onToggleSelect?: (id: string) => void;
  showCheckboxes?: boolean;
  emptyMessage?: string;
  approveTitle?: string;
  unapproveTitle?: string;
  deleteTitle?: string;
  anonymousLabel?: string;
  unknownProductLabel?: string;
}) {
  return (
    <div>
      <h2 className="font-semibold mb-3">{title}</h2>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyMessage ?? "None."}</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const productTitle = getTranslatedField(c.products?.product_translations as any[], "az", "title", c.products?.slug ?? (unknownProductLabel ?? "Unknown product"));
            return (
              <div key={c.id} className="bg-card border border-border rounded-xl p-4 flex gap-4">
                {showCheckboxes && onToggleSelect && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedComments?.has(c.id) ?? false}
                      onChange={() => onToggleSelect(c.id)}
                      className="w-4 h-4 rounded border-border accent-green-500 cursor-pointer"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{c.users?.full_name ?? (anonymousLabel ?? "Anonymous")}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{productTitle}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.content}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!c.approved ? (
                    <button onClick={() => onApprove(c.id, true)} className="p-1.5 rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400 transition" title={approveTitle ?? "Approve"}>
                      <CheckCircle size={16} />
                    </button>
                  ) : (
                    <button onClick={() => onApprove(c.id, false)} className="p-1.5 rounded hover:bg-yellow-500/20 text-muted-foreground hover:text-yellow-400 transition" title={unapproveTitle ?? "Unapprove"}>
                      <XCircle size={16} />
                    </button>
                  )}
                  <button onClick={() => onDelete(c.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition" title={deleteTitle ?? "Delete"}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
