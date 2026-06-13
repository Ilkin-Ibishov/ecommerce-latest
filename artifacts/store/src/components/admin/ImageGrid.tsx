import { useState, useRef } from "react";
import { Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api";
import { getProxyUrl } from "@/lib/image-proxy";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

export interface ProductImage {
  id: string;
  url: string;
  alt_text?: string | null;
  sort_order: number;
  source: string;
}

export interface ImageGridProps {
  productId: string;
  images: ProductImage[];
  onReorder: () => void;
  onDelete: () => void;
}

const SOURCE_BADGE_STYLES: Record<string, string> = {
  search: "bg-blue-100 text-blue-700",
  barcode: "bg-green-100 text-green-700",
  paste: "bg-gray-100 text-gray-700",
  upload: "bg-purple-100 text-purple-700",
};

/**
 * Reorderable grid of current product images with drag-and-drop,
 * delete confirmation, source badges, and primary indicator.
 */
export function ImageGrid({ productId, images, onReorder, onDelete }: ImageGridProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: "", message: "", onConfirm: () => {} });
  const dragCounter = useRef(0);

  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);

  async function handleReorder(newOrder: string[]) {
    setIsReordering(true);
    try {
      const res = await fetch(apiUrl(`/admin/products/${productId}/images/reorder`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ image_ids: newOrder }),
      });
      if (res.ok) {
        onReorder();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsReordering(false);
    }
  }

  async function handleDelete(imageId: string) {
    setConfirmState({
      open: true,
      title: "Delete Image",
      message: "Are you sure you want to delete this image?",
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        setIsDeleting(imageId);
        try {
          const res = await fetch(apiUrl(`/admin/products/${productId}/images/${imageId}`), {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
            },
          });
          if (res.ok) {
            onDelete();
          }
        } catch {
          // Silently fail
        } finally {
          setIsDeleting(null);
        }
      },
    });
  }

  function handleDragStart(e: React.DragEvent, imageId: string) {
    setDraggedId(imageId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", imageId);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverId(null);
    dragCounter.current = 0;
  }

  function handleDragEnter(e: React.DragEvent, imageId: string) {
    e.preventDefault();
    dragCounter.current++;
    if (imageId !== draggedId) {
      setDragOverId(imageId);
    }
  }

  function handleDragLeave() {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverId(null);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    dragCounter.current = 0;

    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    // Compute new order
    const currentOrder = sorted.map((img) => img.id);
    const fromIndex = currentOrder.indexOf(draggedId);
    const toIndex = currentOrder.indexOf(targetId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      return;
    }

    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, draggedId);

    setDraggedId(null);
    handleReorder(newOrder);
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No images yet. Add images using the tabs above.
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-2 md:grid-cols-3 gap-3",
          isReordering && "opacity-60 pointer-events-none"
        )}
      >
        {sorted.map((image) => {
          const isPrimary = image.sort_order === 0;
          const isDragging = draggedId === image.id;
          const isDragOver = dragOverId === image.id;
          const badgeStyle = SOURCE_BADGE_STYLES[image.source] ?? SOURCE_BADGE_STYLES.paste;

          return (
            <div
              key={image.id}
              draggable
              onDragStart={(e) => handleDragStart(e, image.id)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, image.id)}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, image.id)}
              className={cn(
                "relative group rounded-lg border overflow-hidden bg-card transition-all",
                isDragging && "opacity-40 scale-95",
                isDragOver && "border-blue-500 border-2 ring-2 ring-blue-500/30",
                !isDragging && !isDragOver && "border-border"
              )}
            >
              {/* Image preview */}
              <div className="aspect-square">
                <img
                  src={getProxyUrl(image.url, "thumbnail")}
                  alt={image.alt_text ?? "Product image"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>

              {/* Drag handle */}
              <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white rounded p-0.5 cursor-grab active:cursor-grabbing">
                <GripVertical className="w-4 h-4" />
              </div>

              {/* Delete button */}
              <button
                type="button"
                onClick={() => handleDelete(image.id)}
                disabled={isDeleting === image.id}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white rounded p-1 cursor-pointer disabled:opacity-50"
                aria-label="Delete image"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {/* Source badge */}
              <div className={cn("absolute bottom-1 left-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeStyle)}>
                {image.source}
              </div>

              {/* Primary indicator */}
              {isPrimary && (
                <div className="absolute bottom-1 right-1 bg-amber-100 text-amber-800 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                  Primary
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Delete"
        destructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
    </>
  );
}
