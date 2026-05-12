import { createAdminClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import CommentsManager from "@/components/admin/comments-manager";

export const metadata: Metadata = { title: "Comments" };

export default async function AdminCommentsPage() {
  const admin = await createAdminClient();
  const { data: rawComments } = await (admin as any)
    .from("comments")
    .select("*, users(full_name, phone), products(slug, product_translations(lang_code, title))")
    .order("created_at", { ascending: false });

  const comments = (rawComments ?? []) as any[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Comments</h1>
      <CommentsManager initialComments={comments} />
    </div>
  );
}
