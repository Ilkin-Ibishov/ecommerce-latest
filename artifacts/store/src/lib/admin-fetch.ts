import { createClient } from "@/lib/supabase/client";

export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    },
  });
}

export async function adminJson(url: string, options: RequestInit = {}): Promise<any> {
  const res = await adminFetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
