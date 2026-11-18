import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { userFetch } from "@/lib/user-fetch";

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

export function PlatformSection() {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await userFetch(apiUrl("/platform/notifications"));
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json: NotificationsResponse = await res.json();
      setNotifications(json.data ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (notificationId: string) => {
    try {
      const res = await userFetch(apiUrl(`/platform/notifications/${notificationId}/read`), {
        method: "POST",
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
        );
      }
    } catch {
      // Silently fail for mark-as-read
    }
  };

  // If request failed, omit the section completely
  if (failed) return null;
  if (loading) return null;
  if (notifications.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="platform-heading">
      <h2 id="platform-heading" className="text-lg font-semibold">
        {t("Notifications.platformTitle")}
      </h2>
      <div className="space-y-2">
        {notifications.map((notification) => (
          <article
            key={notification.id}
            className={`rounded-lg border p-4 transition-colors ${
              notification.is_read
                ? "border-border bg-card"
                : "border-primary/30 bg-primary/5"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {!notification.is_read && (
                    <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                  )}
                  <time className="text-xs text-muted-foreground" dateTime={notification.created_at}>
                    {new Date(notification.created_at).toLocaleString()}
                  </time>
                </div>
                <p className="text-sm">{notification.content}</p>
              </div>

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
          </article>
        ))}
      </div>
    </section>
  );
}
