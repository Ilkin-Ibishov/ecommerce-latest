import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

/**
 * Notification shape returned from the Control_Plane store-feed endpoint.
 */
interface PlatformNotification {
  id: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

interface NotificationsResponse {
  data: PlatformNotification[];
  unread_count: number;
}

/**
 * The base URL for the platform notifications endpoint.
 * In the MVP approach, the frontend calls the control-plane URL directly
 * via an env var. The store's Per_Store_Credential is sent as a bearer token.
 */
function getNotificationsUrl(): string {
  return import.meta.env.VITE_PLATFORM_NOTIFICATIONS_URL ?? "/api/platform/store-feed/notifications";
}

function getStoreCredential(): string {
  return import.meta.env.VITE_STORE_PLATFORM_SECRET ?? "";
}

function getStoreId(): string {
  return import.meta.env.VITE_STORE_ID ?? "";
}

/**
 * NotificationCenterPage — store-admin page showing platform notifications
 * fetched from the Control_Plane store-feed endpoint.
 *
 * Implements Requirements 7.2 (display content, time, read/unread),
 * 7.7 (all chrome via useI18n, no untranslated keys).
 */
export default function NotificationCenterPage() {
  const { t } = useI18n();

  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = getNotificationsUrl();
      const secret = getStoreCredential();
      const storeId = getStoreId();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (secret) {
        headers["Authorization"] = `Bearer ${secret}`;
      }
      if (storeId) {
        headers["X-Store-Id"] = storeId;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: NotificationsResponse = await res.json();
      setNotifications(json.data ?? []);
      setUnreadCount(json.unread_count ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (notificationId: string) => {
    try {
      const url = getNotificationsUrl();
      const secret = getStoreCredential();
      const storeId = getStoreId();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (secret) {
        headers["Authorization"] = `Bearer ${secret}`;
      }
      if (storeId) {
        headers["X-Store-Id"] = storeId;
      }

      const res = await fetch(`${url}/${notificationId}/read`, {
        method: "POST",
        headers,
      });

      if (res.ok) {
        // Update local state optimistically
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // Silently fail for mark-as-read — notification remains visually unread
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with title and unread badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{t("Notifications.title")}</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-destructive px-2.5 py-0.5 text-xs font-medium text-destructive-foreground">
              {t("Notifications.unreadBadge").replace("{count}", String(unreadCount))}
            </span>
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
          <svg
            className="mb-4 h-12 w-12 text-muted-foreground/50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          <p className="text-sm text-muted-foreground">{t("Notifications.empty")}</p>
        </div>
      )}

      {/* Notification list */}
      {!loading && !error && notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`rounded-lg border p-4 transition-colors ${
                notification.is_read
                  ? "border-border bg-card"
                  : "border-primary/30 bg-primary/5"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Unread indicator dot */}
                  <div className="flex items-center gap-2 mb-1">
                    {!notification.is_read && (
                      <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                    )}
                    <time className="text-xs text-muted-foreground">
                      {new Date(notification.created_at).toLocaleString()}
                    </time>
                  </div>
                  {/* Notification content */}
                  <p className="text-sm">{notification.content}</p>
                </div>

                {/* Mark as read button */}
                {!notification.is_read && (
                  <button
                    type="button"
                    onClick={() => markAsRead(notification.id)}
                    className="flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={t("Notifications.markRead")}
                  >
                    {t("Notifications.markRead")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
