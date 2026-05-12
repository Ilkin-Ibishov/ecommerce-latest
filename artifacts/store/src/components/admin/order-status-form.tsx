"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  "pending",
  "phone_verified",
  "courier_assigned",
  "shipped",
  "delivered",
  "refused_at_delivery",
  "cancelled",
];

export default function OrderStatusForm({
  orderId,
  currentStatus,
}: {
  orderId: string;
  currentStatus: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    if (status === currentStatus) return;
    setLoading(true);
    await fetch(`/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="font-semibold">Update Status</h2>
      <div className="flex gap-3 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              status === s
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <button
        onClick={handleSave}
        disabled={loading || status === currentStatus}
        className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
      >
        {loading ? "Saving…" : saved ? "Saved!" : "Save Status"}
      </button>
    </div>
  );
}
