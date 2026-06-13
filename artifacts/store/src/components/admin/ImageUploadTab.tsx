import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload, X, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api";

export interface ImageUploadTabProps {
  productId: string;
  remainingSlots: number;
  onImageAdded: () => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Drag-and-drop file upload zone for product images.
 *
 * - Drop zone with dashed border, changes styling on drag hover
 * - File picker (hidden input triggered by click)
 * - Client-side validation: type + size
 * - Preview before upload
 * - Upload via POST /api/admin/products/:id/images/upload as FormData
 * - Error states for 413, 415, and general failures
 * - Disabled when remainingSlots === 0
 */
export function ImageUploadTab({
  productId,
  remainingSlots,
  onImageAdded,
}: ImageUploadTabProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const disabled = remainingSlots === 0;

  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewUrl]);

  function validateFile(file: File): string | null {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Accepted formats: JPEG, PNG, WebP, AVIF";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Image file must be under 5 MB";
    }
    return null;
  }

  function handleFile(file: File) {
    setError(null);

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    // Clean up previous preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleZoneClick() {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  }

  async function handleUpload() {
    if (!selectedFile || uploading) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(
        apiUrl(`/admin/products/${productId}/images/upload`),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        if (response.status === 413) {
          setError("Image file must be under 5 MB");
        } else if (response.status === 415) {
          setError("Accepted formats: JPEG, PNG, WebP, AVIF");
        } else {
          setError("Upload failed. Please try again");
        }
        return;
      }

      // Success: clear preview and notify parent
      clearSelection();
      onImageAdded();
    } catch {
      setError("Upload failed. Please try again");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={handleZoneClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors",
          disabled
            ? "cursor-not-allowed border-muted bg-muted/30 opacity-50"
            : dragOver
              ? "cursor-copy border-blue-500 bg-blue-50"
              : "cursor-pointer border-border hover:border-blue-300 hover:bg-accent/50",
          uploading && "pointer-events-none opacity-60"
        )}
      >
        <Upload
          className={cn(
            "h-8 w-8",
            dragOver ? "text-blue-500" : "text-muted-foreground"
          )}
        />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {disabled
              ? "Maximum images reached"
              : "Drag & drop an image here, or click to select"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            JPEG, PNG, WebP, or AVIF — max 5 MB
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.avif"
          onChange={handleFileInput}
          disabled={disabled}
          className="hidden"
        />
      </div>

      {/* File preview */}
      {previewUrl && selectedFile && (
        <div className="flex items-start gap-4 rounded-md border border-border p-3">
          <img
            src={previewUrl}
            alt="Upload preview"
            className="h-24 w-24 rounded-md object-cover"
          />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={clearSelection}
                disabled={uploading}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
