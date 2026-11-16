import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";
import { Shimmer } from "@/components/ui/shimmer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface SizeGuideOverlayProps {
  categoryId: string;
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

interface SizeGuideResponse {
  category_id: string;
  headers: string[];
  rows: Array<string[]>;
  measurement_unit: "cm" | "inches";
  updated_at: string;
}

async function fetchSizeGuide(
  categoryId: string,
  locale: string
): Promise<SizeGuideResponse> {
  const url = apiUrl(`/size-guides/${categoryId}?locale=${locale}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch size guide: ${res.status}`);
  }
  return res.json();
}

function SizeGuideSkeleton() {
  return (
    <div className="space-y-3">
      <Shimmer className="h-5 w-1/3 rounded" />
      <div className="space-y-2">
        <Shimmer className="h-8 w-full rounded" />
        <Shimmer className="h-6 w-full rounded" />
        <Shimmer className="h-6 w-full rounded" />
        <Shimmer className="h-6 w-full rounded" />
        <Shimmer className="h-6 w-full rounded" />
      </div>
    </div>
  );
}

export function SizeGuideOverlay({
  categoryId,
  open,
  onClose,
  triggerRef,
}: SizeGuideOverlayProps) {
  const { t, locale } = useI18n();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["size-guide", categoryId, locale],
    queryFn: () => fetchSizeGuide(categoryId, locale),
    enabled: open,
  });

  // Return focus to trigger on close
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose();
        setTimeout(() => {
          triggerRef.current?.focus();
        }, 0);
      }
    },
    [onClose, triggerRef]
  );

  // Handle focus return when parent sets open to false
  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("SizeGuide.header")}</DialogTitle>
        </DialogHeader>

        {isLoading && <SizeGuideSkeleton />}

        {isError && (
          <div className="text-center py-6">
            <p className="text-destructive text-sm mb-4">
              {t("SizeGuide.error")}
            </p>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4"
            >
              {t("SizeGuide.close")}
            </button>
          </div>
        )}

        {data && !isLoading && !isError && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  {data.headers.map((header, idx) => (
                    <th
                      key={idx}
                      className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b last:border-b-0">
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="px-3 py-2 whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
