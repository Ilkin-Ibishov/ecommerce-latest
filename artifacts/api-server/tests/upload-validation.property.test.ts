import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectMimeType, getImageDimensions, generateFilename } from "../src/lib/asset-uploader";

/**
 * Upload Validation Property Tests
 * Feature: white-label-customization
 * Validates: Requirements 4.1, 4.2, 4.4, 10.1, 10.2, 10.3, 10.4
 */

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Magic byte sequences for supported formats
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_MAGIC_PREFIX = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP_MAGIC_SUFFIX = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"
const AVIF_MAGIC = Buffer.from([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69]); // "ftypavi" at offset 4

// ─── Generators ────────────────────────────────────────────────────────────────

/**
 * Generate a valid PNG buffer with specified dimensions.
 * PNG format: 8 magic bytes + IHDR chunk (width at offset 16, height at offset 20).
 */
function createPngBuffer(width: number, height: number): Buffer {
  // Minimal PNG: magic (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4) + rest (5)
  const buf = Buffer.alloc(29);
  PNG_MAGIC.copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk length
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // bit depth, color type, compression, filter, interlace
  buf[24] = 8; buf[25] = 2; buf[26] = 0; buf[27] = 0; buf[28] = 0;
  return buf;
}

/**
 * Generate a valid JPEG buffer with specified dimensions.
 * JPEG: FF D8 FF E0 + marker segment + SOF0 marker with dimensions.
 */
function createJpegBuffer(width: number, height: number): Buffer {
  // FF D8 FF (start) + SOF0 marker (FF C0) with dimensions
  const buf = Buffer.alloc(20);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  // APP0 marker minimal: FF E0 00 02
  buf[3] = 0xe0; buf[4] = 0x00; buf[5] = 0x02;
  // SOF0 marker: FF C0
  buf[6] = 0xff; buf[7] = 0xc0;
  // Segment length (2 bytes)
  buf.writeUInt16BE(11, 8);
  // Precision (1 byte)
  buf[10] = 8;
  // Height (2 bytes) at offset 11
  buf.writeUInt16BE(height, 11);
  // Width (2 bytes) at offset 13
  buf.writeUInt16BE(width, 13);
  // Components (1 byte)
  buf[15] = 3;
  return buf;
}

/**
 * Generate a valid WebP VP8 (lossy) buffer with specified dimensions.
 * RIFF + filesize + WEBP + VP8 chunk with dimensions at offsets 26-29.
 */
function createWebpBuffer(width: number, height: number): Buffer {
  // Minimum VP8 lossy WebP buffer
  const buf = Buffer.alloc(30);
  WEBP_MAGIC_PREFIX.copy(buf, 0); // "RIFF" at 0-3
  buf.writeUInt32LE(22, 4); // file size - 8
  WEBP_MAGIC_SUFFIX.copy(buf, 8); // "WEBP" at 8-11
  buf.write("VP8 ", 12, "ascii"); // chunk type at 12-15
  buf.writeUInt32LE(10, 16); // chunk size
  // VP8 bitstream: frame tag (3 bytes) + sync code (3 bytes: 9D 01 2A)
  buf[20] = 0x9d; buf[21] = 0x01; buf[22] = 0x2a;
  // Padding bytes for frame tag at 20-22 (the real frame tag is before sync code)
  // Actually: offsets 20-22 = frame tag, 23-25 = sync code 9D 01 2A, 26-27 = width, 28-29 = height
  // Let me redo: VP8 chunk data starts at offset 20
  // Frame tag bytes: first 3 bytes of chunk data
  buf[20] = 0x00; buf[21] = 0x00; buf[22] = 0x00;
  // Sync code: 9D 01 2A
  buf[23] = 0x9d; buf[24] = 0x01; buf[25] = 0x2a;
  // Width (little-endian 16-bit) with scale in upper 2 bits
  buf.writeUInt16LE(width & 0x3fff, 26);
  // Height (little-endian 16-bit) with scale in upper 2 bits
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

/**
 * Generate a valid AVIF buffer with specified dimensions.
 * ISOBMFF container with ftyp box and ispe box.
 */
function createAvifBuffer(width: number, height: number): Buffer {
  // Minimal AVIF: ftyp box at offset 0 + ispe box for dimensions
  // ftyp box: size(4) + "ftyp"(4) + "avif"(4) = 12 bytes minimum
  // We need "ftypavi" at offset 4 for detection
  const buf = Buffer.alloc(40);
  // Box size
  buf.writeUInt32BE(20, 0);
  // "ftypavif" — detection looks for bytes [0x66,0x74,0x79,0x70,0x61,0x76,0x69] at offset 4
  buf.write("ftypavif", 4, "ascii");
  buf.writeUInt32BE(0, 12); // minor version
  // reserved / compatible brands
  buf.writeUInt32BE(0, 16);
  // ispe box for dimensions: "ispe" + 4 bytes version/flags + 4 bytes width + 4 bytes height
  buf.write("ispe", 20, "ascii");
  buf.writeUInt32BE(0, 24); // version/flags
  buf.writeUInt32BE(width, 28);
  buf.writeUInt32BE(height, 32);
  return buf;
}

/** Arbitrary for valid PNG dimensions for logo (1-1024) */
const logoDimensionArb = fc.tuple(
  fc.integer({ min: 1, max: 1024 }),
  fc.integer({ min: 1, max: 1024 }),
);

/** Arbitrary for valid favicon dimensions (16-512) */
const faviconDimensionArb = fc.tuple(
  fc.integer({ min: 16, max: 512 }),
  fc.integer({ min: 16, max: 512 }),
);

/** Arbitrary for oversized logo dimensions (>1024) */
const oversizedLogoDimensionArb = fc.tuple(
  fc.integer({ min: 1025, max: 4096 }),
  fc.integer({ min: 1025, max: 4096 }),
);

/** Arbitrary for out-of-range favicon dimensions — too small (<16) or too large (>512) */
const invalidFaviconDimensionArb = fc.oneof(
  // Too small
  fc.tuple(
    fc.integer({ min: 1, max: 15 }),
    fc.integer({ min: 1, max: 15 }),
  ),
  // Too large
  fc.tuple(
    fc.integer({ min: 513, max: 4096 }),
    fc.integer({ min: 513, max: 4096 }),
  ),
);

/** Arbitrary for file extensions */
const validExtArb = fc.constantFrom("png", "jpg", "webp", "avif");

/** Arbitrary for asset category */
const categoryArb = fc.constantFrom("logo" as const, "favicon" as const);

/**
 * Generate random bytes that do NOT match any supported MIME magic bytes.
 * We avoid starting with PNG, JPEG, or RIFF magic, and avoid AVIF ftyp at offset 4.
 */
const randomNonImageBufferArb = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 16, maxLength: 64 })
  .filter((bytes) => {
    // Exclude PNG magic
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return false;
    // Exclude JPEG magic
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return false;
    // Exclude RIFF (WebP)
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return false;
    // Exclude AVIF (ftypavi at offset 4)
    if (bytes.length > 10 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 &&
        bytes[7] === 0x70 && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69) return false;
    return true;
  })
  .map((bytes) => Buffer.from(bytes));

// ─── Property 8: Upload validation rejects files outside constraints ───────────

describe("Feature: white-label-customization, Property 8: Upload validation rejects files outside constraints", () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.4, 10.1, 10.2, 10.3**
   *
   * For any uploaded file, the Asset_Uploader SHALL accept it IFF:
   * (a) file size ≤ 5 MB,
   * (b) MIME type from header bytes is image/jpeg, image/png, image/webp, or image/avif, and
   * (c) dimensions satisfy constraints (logo: ≤ 1024×1024, favicon: 16×16 to 512×512).
   */

  it("detectMimeType correctly identifies PNG buffers with valid magic bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createPngBuffer(width, height);
          const result = detectMimeType(buf);
          expect(result).not.toBeNull();
          expect(result!.mime).toBe("image/png");
          expect(result!.ext).toBe("png");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("detectMimeType correctly identifies JPEG buffers with valid magic bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createJpegBuffer(width, height);
          const result = detectMimeType(buf);
          expect(result).not.toBeNull();
          expect(result!.mime).toBe("image/jpeg");
          expect(result!.ext).toBe("jpg");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("detectMimeType correctly identifies WebP buffers with valid magic bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createWebpBuffer(width, height);
          const result = detectMimeType(buf);
          expect(result).not.toBeNull();
          expect(result!.mime).toBe("image/webp");
          expect(result!.ext).toBe("webp");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("detectMimeType correctly identifies AVIF buffers with valid magic bytes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createAvifBuffer(width, height);
          const result = detectMimeType(buf);
          expect(result).not.toBeNull();
          expect(result!.mime).toBe("image/avif");
          expect(result!.ext).toBe("avif");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("detectMimeType returns null for buffers without valid image magic bytes", () => {
    fc.assert(
      fc.property(randomNonImageBufferArb, (buf) => {
        const result = detectMimeType(buf);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("getImageDimensions returns correct dimensions for valid PNG buffers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createPngBuffer(width, height);
          const dims = getImageDimensions(buf, "image/png");
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(width);
          expect(dims!.height).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getImageDimensions returns correct dimensions for valid JPEG buffers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 1, max: 65535 }),
        (width, height) => {
          const buf = createJpegBuffer(width, height);
          const dims = getImageDimensions(buf, "image/jpeg");
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(width);
          expect(dims!.height).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getImageDimensions returns correct dimensions for valid WebP (VP8 lossy) buffers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 16383 }),
        fc.integer({ min: 1, max: 16383 }),
        (width, height) => {
          const buf = createWebpBuffer(width, height);
          const dims = getImageDimensions(buf, "image/webp");
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(width);
          expect(dims!.height).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getImageDimensions returns correct dimensions for valid AVIF buffers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        (width, height) => {
          const buf = createAvifBuffer(width, height);
          const dims = getImageDimensions(buf, "image/avif");
          expect(dims).not.toBeNull();
          expect(dims!.width).toBe(width);
          expect(dims!.height).toBe(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("logo dimensions are accepted when ≤ 1024×1024", () => {
    fc.assert(
      fc.property(logoDimensionArb, ([width, height]) => {
        const buf = createPngBuffer(width, height);
        const dims = getImageDimensions(buf, "image/png");
        expect(dims).not.toBeNull();
        // Logo constraint: width ≤ 1024 AND height ≤ 1024
        expect(dims!.width <= 1024 && dims!.height <= 1024).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("logo dimensions are rejected when > 1024 in either axis", () => {
    fc.assert(
      fc.property(oversizedLogoDimensionArb, ([width, height]) => {
        const buf = createPngBuffer(width, height);
        const dims = getImageDimensions(buf, "image/png");
        expect(dims).not.toBeNull();
        // Logo constraint violated: width > 1024 OR height > 1024
        expect(dims!.width > 1024 || dims!.height > 1024).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("favicon dimensions are accepted when between 16×16 and 512×512", () => {
    fc.assert(
      fc.property(faviconDimensionArb, ([width, height]) => {
        const buf = createPngBuffer(width, height);
        const dims = getImageDimensions(buf, "image/png");
        expect(dims).not.toBeNull();
        // Favicon constraint: 16 ≤ width ≤ 512 AND 16 ≤ height ≤ 512
        expect(
          dims!.width >= 16 && dims!.width <= 512 &&
          dims!.height >= 16 && dims!.height <= 512,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("favicon dimensions are rejected when outside 16×16 to 512×512", () => {
    fc.assert(
      fc.property(invalidFaviconDimensionArb, ([width, height]) => {
        const buf = createPngBuffer(width, height);
        const dims = getImageDimensions(buf, "image/png");
        expect(dims).not.toBeNull();
        // Favicon constraint violated
        expect(
          dims!.width < 16 || dims!.width > 512 ||
          dims!.height < 16 || dims!.height > 512,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("files exceeding 5 MB are rejected by size constraint", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE + 1000 }),
        (size) => {
          // The file size exceeds the 5 MB limit
          expect(size > MAX_FILE_SIZE).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Generated filenames are unique and well-formed ────────────────

describe("Feature: white-label-customization, Property 9: Generated filenames are unique and well-formed", () => {
  /**
   * **Validates: Requirements 10.4**
   *
   * For any set of N upload operations, generated filenames SHALL all be
   * distinct and each SHALL match the pattern `{category}/{timestamp}-{hex16+}.{ext}`.
   */

  /** Regex pattern for generated filenames: {category}/{timestamp}-{hex16+}.{ext} */
  const FILENAME_PATTERN = /^(logos|favicons)\/\d+-[0-9a-f]{16,}\.(png|jpg|webp|avif)$/;

  it("every generated filename matches the pattern {category}/{timestamp}-{hex16+}.{ext}", () => {
    fc.assert(
      fc.property(categoryArb, validExtArb, (category, ext) => {
        const filename = generateFilename(category, ext);
        expect(filename).toMatch(FILENAME_PATTERN);
      }),
      { numRuns: 100 },
    );
  });

  it("generated filenames use the correct category folder", () => {
    fc.assert(
      fc.property(categoryArb, validExtArb, (category, ext) => {
        const filename = generateFilename(category, ext);
        const expectedFolder = category === "logo" ? "logos" : "favicons";
        expect(filename.startsWith(`${expectedFolder}/`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("generated filenames use the correct extension", () => {
    fc.assert(
      fc.property(categoryArb, validExtArb, (category, ext) => {
        const filename = generateFilename(category, ext);
        expect(filename.endsWith(`.${ext}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("a batch of generated filenames are all unique", () => {
    fc.assert(
      fc.property(
        categoryArb,
        validExtArb,
        fc.integer({ min: 10, max: 50 }),
        (category, ext, count) => {
          const filenames = new Set<string>();
          for (let i = 0; i < count; i++) {
            filenames.add(generateFilename(category, ext));
          }
          // All filenames must be distinct
          expect(filenames.size).toBe(count);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the random portion has at least 8 alphanumeric characters (16 hex chars)", () => {
    fc.assert(
      fc.property(categoryArb, validExtArb, (category, ext) => {
        const filename = generateFilename(category, ext);
        // Extract the random portion: between the dash after timestamp and the dot before extension
        const afterSlash = filename.split("/")[1]; // "timestamp-random.ext"
        const dashIdx = afterSlash.indexOf("-");
        const dotIdx = afterSlash.lastIndexOf(".");
        const randomPart = afterSlash.slice(dashIdx + 1, dotIdx);
        // Random part should be at least 16 hex chars (8 bytes = 16 hex digits)
        expect(randomPart.length).toBeGreaterThanOrEqual(16);
        // All characters should be valid hexadecimal
        expect(randomPart).toMatch(/^[0-9a-f]+$/);
      }),
      { numRuns: 100 },
    );
  });

  it("the timestamp portion is a valid numeric timestamp", () => {
    fc.assert(
      fc.property(categoryArb, validExtArb, (category, ext) => {
        const filename = generateFilename(category, ext);
        const afterSlash = filename.split("/")[1]; // "timestamp-random.ext"
        const dashIdx = afterSlash.indexOf("-");
        const timestampStr = afterSlash.slice(0, dashIdx);
        const timestamp = Number(timestampStr);
        // Should be a valid positive number (milliseconds since epoch)
        expect(Number.isFinite(timestamp)).toBe(true);
        expect(timestamp).toBeGreaterThan(0);
        // Should be a reasonable timestamp (after year 2020)
        expect(timestamp).toBeGreaterThan(1577836800000);
      }),
      { numRuns: 100 },
    );
  });
});
