import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

export default function AdminCommentsPage() {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any).from("comments")
      .select("*, users(full_name, phone), products(slug, product_translations(lang_code, title))")
      .order("created_at", { ascending: false })
      .then(({ data }: any) => { setComments(data ?? []); setLoading(false); });
  }, []);

  const approve = async (id: string, approved: boolean) => {
    await fetch(apiUrl(`/admin/comments/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }) });
    setComments((prev) => prev.map((c) => c.id === id ? { ...c, approved } : c));
  };

  const remove = async (id: string) => {
    await fetch(apiUrl(`/admin/comments/${id}`), { method: "DELETE" });
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const pending = comments.filter((c) => !c.approved);
  const approved = comments.filter((c) => c.approved);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Comments</h1>
      <Section title={`Pending Approval (${pending.length})`} comments={pending} onApprove={approve} onDelete={remove} />
      <Section title={`Approved (${approved.length})`} comments={approved} onApprove={approve} onDelete={remove} />
    </div>
  );
}

function Section({ title, comments, onApprove, onDelete }: {
  title: string; comments: any[];
  onApprove: (id: string, approved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <h2 className="font-semibold mb-3">{title}</h2>
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">None.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const productTitle = (c.products?.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title ?? c.products?.slug ?? "Unknown product";
            return (
              <div key={c.id} className="bg-card border border-border rounded-xl p-4 flex gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{c.users?.full_name ?? "Anonymous"}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{productTitle}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{c.content}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!c.approved ? (
                    <button onClick={() => onApprove(c.id, true)} className="p-1.5 rounded hover:bg-green-500/20 text-muted-foreground hover:text-green-400 transition" title="Approve">
                      <CheckCircle size={16} />
                    </button>
                  ) : (
                    <button onClick={() => onApprove(c.id, false)} className="p-1.5 rounded hover:bg-yellow-500/20 text-muted-foreground hover:text-yellow-400 transition" title="Unapprove">
                      <XCircle size={16} />
                    </button>
                  )}
                  <button onClick={() => onDelete(c.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition" title="Delete">
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
