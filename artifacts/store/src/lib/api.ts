export function apiUrl(path: string): string {
  const apiBase = import.meta.env.VITE_API_URL ?? "/api";
  return `${apiBase}${path}`;
}
