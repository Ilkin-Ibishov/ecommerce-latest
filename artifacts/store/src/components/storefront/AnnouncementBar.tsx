import { useState } from "react";
import { X, Truck } from "lucide-react";

export default function AnnouncementBar() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="bg-yellow-500 text-gray-900 text-xs sm:text-sm py-2 px-4 flex items-center justify-center gap-2 relative font-medium">
      <Truck size={14} className="shrink-0" />
      <span className="text-center">
        100 AZN-dən yuxarı sifarişlərə <strong>Pulsuz Çatdırılma</strong> · Bütün Azərbaycan üzrə
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:opacity-60 transition"
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
