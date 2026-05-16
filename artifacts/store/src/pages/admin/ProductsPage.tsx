import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProducts = async () => {
    const supabase = createClient();
    const { data } = await (supabase as any)
      .from("products")
      .select("id, slug, price, stock, is_featured, is_on_sale, product_images(url), product_translations(lang_code, title)")
      .order("sort_order");
    setProducts(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    await fetch(apiUrl(`/admin/products/${id}`), { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Products</h1>
        <Link href="/admin/products/new" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
          <Plus size={16} /> New Product
        </Link>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Product</th>
              <th className="text-left px-4 py-3 font-medium">Slug</th>
              <th className="text-right px-4 py-3 font-medium">Price</th>
              <th className="text-right px-4 py-3 font-medium">Stock</th>
              <th className="text-left px-4 py-3 font-medium">Flags</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                No products yet. <Link href="/admin/products/new" className="text-primary hover:underline">Add the first one.</Link>
              </td></tr>
            ) : products.map((p: any) => {
              const img = p.product_images?.[0]?.url ?? null;
              const title = p.product_translations?.find((t: any) => t.lang_code === "az")?.title ?? p.product_translations?.[0]?.title ?? "Untitled";
              return (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                        {img ? <img src={img} alt={title} className="object-cover w-full h-full" /> : <div className="w-full h-full bg-muted" />}
                      </div>
                      <span className="font-medium line-clamp-1">{title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.slug}</td>
                  <td className="px-4 py-3 text-right font-medium">{Number(p.price).toFixed(2)} AZN</td>
                  <td className={`px-4 py-3 text-right font-medium ${p.stock < 5 ? "text-red-400" : ""}`}>{p.stock}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {p.is_featured && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Featured</span>}
                      {p.is_on_sale && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Sale</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/products/${p.id}/edit`} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></Link>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
