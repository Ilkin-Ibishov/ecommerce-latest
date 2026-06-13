import { randomBytes } from "crypto";
import { getAdminSupabase } from "./supabase.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetCategory = "logo" | "favicon" | "product";

export interface UploadOptions {
  category: AssetCategory;
  file: Buffer;
  originalName: string;
  previousUrl?: string | null;
}

export interface UploadResult {
  url: string;   // Public CDN URL
  path: string;  // Storage path within bucket
}

export class AssetValidationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AssetValidationError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUCKET_NAME = "site-assets";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB overall
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB for logo
const MAX_FAVICON_SIZE = 512 * 1024; // 512 KB for favicon

const CATEGORY_FOLDER: Record<AssetCategory, string> = {
  logo: "logos",
  favicon: "favicons",
  product: "products",
};

// ---------------------------------------------------------------------------
// MIME Detection via Magic Bytes
// ---------------------------------------------------------------------------

interface MimeSignature {
  mime: string;
  ext: string;
  bytes: number[];
  offset?: number;
}

const MIME_SIGNATURES: MimeSignature[] = [
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG: FF D8 FF
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  // WebP: RIFF....WEBP
  { mime: "image/webp", ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46] },
  // AVIF: ....ftypavif or ....ftypavis
  { mime: "image/avif", ext: "avif", bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69], offset: 4 },
];

/**
 * Detect MIME type by reading magic bytes from the file buffer.
 */
export function detectMimeType(buffer: Buffer): { mime: string; ext: string } | null {
  for (const sig of MIME_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Additional check for WebP: bytes 8-11 should be "WEBP"
      if (sig.mime === "image/webp") {
        if (buffer.length < 12) continue;
        const webpMagic = buffer.slice(8, 12).toString("ascii");
        if (webpMagic !== "WEBP") continue;
      }
      return { mime: sig.mime, ext: sig.ext };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Image Dimension Parsing (without external deps at runtime)
// ---------------------------------------------------------------------------

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Parse image dimensions from buffer for supported formats.
 * Falls back to image-size package if available.
 */
export function getImageDimensions(buffer: Buffer, mime: string): ImageDimensions | null {
  switch (mime) {
    case "image/png":
      return getPngDimensions(buffer);
    case "image/jpeg":
      return getJpegDimensions(buffer);
    case "image/webp":
      return getWebpDimensions(buffer);
    case "image/avif":
      return getAvifDimensions(buffer);
    default:
      return null;
  }
}

function getPngDimensions(buffer: Buffer): ImageDimensions | null {
  // PNG IHDR chunk starts at offset 16: 4 bytes width, 4 bytes height
  if (buffer.length < 24) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function getJpegDimensions(buffer: Buffer): ImageDimensions | null {
  // Scan JPEG markers for SOF (Start of Frame)
  if (buffer.length < 4) return null;

  let offset = 2; // Skip FF D8
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // Skip FF padding bytes
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip this marker segment
    if (offset + 3 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  return null;
}

function getWebpDimensions(buffer: Buffer): ImageDimensions | null {
  // WebP has RIFF header (12 bytes) then VP8/VP8L/VP8X chunk
  if (buffer.length < 30) return null;

  const chunk = buffer.slice(12, 16).toString("ascii");

  if (chunk === "VP8 ") {
    // Lossy WebP: dimensions at offset 26-29
    if (buffer.length < 30) return null;
    // Skip chunk header, frame tag (3 bytes at offset 23)
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }

  if (chunk === "VP8L") {
    // Lossless WebP: dimensions encoded in first 4 bytes of data
    if (buffer.length < 25) return null;
    // Signature byte at offset 21 should be 0x2F
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  if (chunk === "VP8X") {
    // Extended WebP: width at offset 24 (3 bytes LE + 1), height at offset 27 (3 bytes LE + 1)
    if (buffer.length < 30) return null;
    const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
    const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
    return { width, height };
  }

  return null;
}

function getAvifDimensions(buffer: Buffer): ImageDimensions | null {
  // AVIF uses ISOBMFF container. Dimensions are in ispe box.
  // Search for 'ispe' box (image spatial extents)
  for (let i = 0; i < buffer.length - 12; i++) {
    if (
      buffer[i] === 0x69 && // 'i'
      buffer[i + 1] === 0x73 && // 's'
      buffer[i + 2] === 0x70 && // 'p'
      buffer[i + 3] === 0x65 // 'e'
    ) {
      // ispe box: 4 bytes type + 4 bytes version/flags + 4 bytes width + 4 bytes height
      const dataOffset = i + 4 + 4; // skip type + version/flags
      if (dataOffset + 8 > buffer.length) return null;
      const width = buffer.readUInt32BE(dataOffset);
      const height = buffer.readUInt32BE(dataOffset + 4);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filename Generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique filename: {category}/{timestamp}-{random8+}.{ext}
 */
export function generateFilename(category: AssetCategory, ext: string): string {
  const folder = CATEGORY_FOLDER[category];
  const timestamp = Date.now();
  const random = randomBytes(8).toString("hex"); // 16 hex chars (well over 8 alphanum)
  return `${folder}/${timestamp}-${random}.${ext}`;
}

// ---------------------------------------------------------------------------
// Main Upload Function
// ---------------------------------------------------------------------------

/**
 * Validate and upload an image asset to Supabase Storage.
 *
 * @param options - Category, file buffer, original name, and optional previous URL for replacement
 * @returns The public CDN URL and storage path of the uploaded asset
 * @throws AssetValidationError for validation failures
 */
export async function validateAndUpload(
  options: UploadOptions
): Promise<UploadResult> {
  const { category, file, previousUrl } = options;

  // 1. Validate overall file size
  if (file.length > MAX_FILE_SIZE) {
    throw new AssetValidationError(
      `File exceeds the maximum allowed size of 5 MB`,
      413
    );
  }

  // 2. Validate category-specific file size
  if (category === "logo" && file.length > MAX_LOGO_SIZE) {
    throw new AssetValidationError(
      `Logo file exceeds the maximum allowed size of 2 MB`,
      413
    );
  }
  if (category === "favicon" && file.length > MAX_FAVICON_SIZE) {
    throw new AssetValidationError(
      `Favicon file exceeds the maximum allowed size of 512 KB`,
      413
    );
  }

  // 3. Validate MIME type via magic bytes
  const detected = detectMimeType(file);
  if (!detected) {
    throw new AssetValidationError(
      `File type is not supported. Accepted types: image/jpeg, image/png, image/webp, image/avif`,
      415
    );
  }

  // 4. Validate image dimensions
  const dimensions = getImageDimensions(file, detected.mime);
  if (!dimensions) {
    throw new AssetValidationError(
      `Unable to determine image dimensions. File may be corrupted.`,
      415
    );
  }

  if (category === "logo") {
    if (dimensions.width > 1024 || dimensions.height > 1024) {
      throw new AssetValidationError(
        `Logo dimensions exceed the maximum of 1024×1024 pixels (got ${dimensions.width}×${dimensions.height})`,
        413
      );
    }
  }

  if (category === "favicon") {
    if (
      dimensions.width < 16 ||
      dimensions.height < 16 ||
      dimensions.width > 512 ||
      dimensions.height > 512
    ) {
      throw new AssetValidationError(
        `Favicon dimensions must be between 16×16 and 512×512 pixels (got ${dimensions.width}×${dimensions.height})`,
        413
      );
    }
  }

  // 5. Generate unique filename
  const filename = generateFilename(category, detected.ext);

  // 6. Upload to Supabase Storage
  const supabase = getAdminSupabase();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, file, {
      contentType: detected.mime,
      upsert: false,
    });

  if (uploadError) {
    throw new AssetValidationError(
      `Upload failed: ${uploadError.message}`,
      500
    );
  }

  // 7. Get public URL
  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filename);

  const publicUrl = urlData.publicUrl;

  // 8. Delete previous asset (don't block on failure)
  if (previousUrl) {
    deletePreviousAsset(previousUrl).catch((err) => {
      logger.warn(
        { error: err, previousUrl },
        "Failed to delete previous asset after successful upload"
      );
    });
  }

  return { url: publicUrl, path: filename };
}

// ---------------------------------------------------------------------------
// Previous Asset Deletion
// ---------------------------------------------------------------------------

/**
 * Extract the storage path from a public CDN URL and delete the old file.
 */
async function deletePreviousAsset(url: string): Promise<void> {
  // Public URLs typically look like:
  // https://{project}.supabase.co/storage/v1/object/public/site-assets/logos/1703123456789-abc123.png
  const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) {
    logger.warn({ url }, "Could not extract path from previous asset URL");
    return;
  }

  const path = url.slice(idx + marker.length);
  if (!path) {
    logger.warn({ url }, "Empty path extracted from previous asset URL");
    return;
  }

  const supabase = getAdminSupabase();
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

  if (error) {
    throw new Error(`Failed to delete previous asset: ${error.message}`);
  }
}
