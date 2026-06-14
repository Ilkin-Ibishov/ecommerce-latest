import { createClient } from "@/lib/supabase/client";

/**
 * Builds the `Authorization` header from the current Supabase session.
 * Mirrors the logic previously re-implemented in `useProfile` and `WishlistPage`:
 * `Bearer ${session?.access_token}` (an absent token yields `Bearer undefined`).
 */
export async function getAuthHeader(): Promise<{ Authorization: string }> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token}` };
}

/**
 * `fetch` wrapper that attaches the current user's auth header.
 * Caller-supplied headers are preserved and the auth header is merged in.
 */
export async function userFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeader = await getAuthHeader();
  return fetch(url, { ...options, headers: { ...options.headers, ...authHeader } });
}
