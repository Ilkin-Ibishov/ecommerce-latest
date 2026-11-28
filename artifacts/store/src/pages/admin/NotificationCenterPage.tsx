import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { userFetch } from "@/lib/user-fetch";
import type { InboxResponse } from "@/components/admin/notifications/types";
import { NeedsYouSection } from "@/components/admin/notifications/NeedsYouSection";
import { HappenedSection } from "@/components/admin/notifications/HappenedSection";
import { PlatformSection } from "@/components/admin/notifications/PlatformSection";

export default function NotificationCenterPage() {
  const { t } = useI18n();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingSeen, setMarkingSeen] = useState(false);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userFetch(apiUrl("/admin/inbox"));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: InboxResponse = await res.json();
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const handleMarkSeen = async () => {
    setMarkingSeen(true);
    try {
      // The marker is the time of the newest event shown, so the database clock decides
      // what counts as seen, not this browser's or the API host's.
      const times = (data?.events ?? []).map((e) => new Date(e.time).getTime());
      const seen_through = times.length ? new Date(Math.max(...times)).toISOString() : undefined;
      const res = await userFetch(apiUrl("/admin/inbox/seen"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seen_through }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event("admin-inbox-changed"));
        await fetchInbox();
      }
    } catch {
      // Ignore
    } finally {
      setMarkingSeen(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("Notifications.title")}</h1>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-6">
          <NeedsYouSection items={data.needs_you} />
          {data.events !== null && (
            <HappenedSection
              events={data.events}
              onMarkSeen={handleMarkSeen}
              isMarkingSeen={markingSeen}
            />
          )}
          <PlatformSection />
        </div>
      )}
    </div>
  );
}
