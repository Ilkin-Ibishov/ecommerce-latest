/**
 * Platform-aware fetch helper.
 * Attaches the super admin's access token from the control-plane session.
 */
import { getControlPlaneClient } from "./client";
import { apiUrl } from "../api";

/**
 * Fetch a platform API endpoint with the super admin's auth token.
 * Wraps the standard fetch() and adds Authorization header.
 *
 * @param path - API path (e.g. "/platform/stores") — will be passed through apiUrl()
 * @param init - Standard RequestInit options (method, body, headers, signal, etc.)
 */
export async function platformFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const client = getControlPlaneClient();
  const { data: { session } } = await client.auth.getSession();
  const token = session?.access_token;

  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(apiUrl(path), { ...init, headers });
}
