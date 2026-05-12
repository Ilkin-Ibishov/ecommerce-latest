import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminSidebar from "@/components/admin/sidebar";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s | Admin",
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/az");
  }

  const { data: profileRaw } = await (supabase as any)
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const profile = profileRaw as { role: string } | null;

  if (profile?.role !== "admin") {
    redirect("/az");
  }

  return (
    <div className="admin-theme flex h-screen overflow-hidden bg-background text-foreground">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
