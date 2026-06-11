import { describe, it, expect } from "vitest";
import {
  detectMimeType,
  getImageDimensions,
  generateFilename,
  type AssetCategory,
} from "../src/lib/asset-uploader.ts";

// ---------------------------------------------------------------------------
// Helper: Create minimal valid image buffers for testing
// ---------------------------------------------------------------------------

function createPngBuffer(width: number, height: number): Buffer {
  // Minimal PNG: signature + IHDR chunk
  const buf = Buffer.alloc(33);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (13 bytes)
  buf.writeUInt32BE(13, 8);
  // IHDR chunk type
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width and Height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth, color type, compression, filter, interlace
  buf.set([8, 2, 0, 0, 0], 24);
  return buf;
}

function createJpegBuffer(width: number, height: number): Buffer {
  // Minimal JPEG with SOI + SOF0 marker
  const buf = Buffer.alloc(20);
  // SOI marker
  buf[0] = 0xff;
  buf[1] = 0xd8;
  // SOF0 marker
  buf[2] = 0xff;
  buf[3] = 0xc0;
  // Segment length
  buf.writeUInt16BE(17, 4);
  // Precision
  buf[6] = 8;
  // Height and Width
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  // Number of components
  buf[11] = 3;
  return buf;
}

function createWebpVP8Buffer(width: number, height: number): Buffer {
  // Minimal WebP lossy (VP8 chunk)
  const buf = Buffer.alloc(30);
  // RIFF header
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  buf.writeUInt32LE(22, 4); // File size - 8
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  // VP8 chunk
  buf.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  buf.writeUInt32LE(10, 16); // Chunk size
  // VP8 bitstream header (frame tag + key frame marker)
  buf[20] = 0x9d;
  buf[21] = 0x01;
  buf[22] = 0x2a;
  // Sync code at offset 23
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  // Width and Height (little-endian, 14 bits)
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

function createAvifBuffer(width: number, height: number): Buffer {
  // Minimal AVIF with ftyp box and ispe box
  const buf = Buffer.alloc(40);
  // ftyp box (size=20, type='ftyp', brand='avif')
  buf.writeUInt32BE(20, 0);
  buf.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  buf.set([0x61, 0x76, 0x69, 0x66], 8); // "avif"
  // ispe box at offset 20
  buf.writeUInt32BE(20, 20); // box size
  buf.set([0x69, 0x73, 0x70, 0x65], 24); // "ispe"
  // Version and flags (4 bytes)
  buf.writeUInt32BE(0, 28);
  // Width and Height
  buf.writeUInt32BE(width, 32);
  buf.writeUInt32BE(height, 36);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests: detectMimeType
// ---------------------------------------------------------------------------

describe("detectMimeType", () => {
  it("detects PNG from magic bytes", () => {
    const buf = createPngBuffer(100, 100);
    const result = detectMimeType(buf);
    expect(result).toEqual({ mime: "image/png", ext: "png" });
  });

  it("detects JPEG from magic bytes", () => {
    const buf = createJpegBuffer(100, 100);
    const result = detectMimeType(buf);
    expect(result).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });

  it("detects WebP from magic bytes", () => {
    const buf = createWebpVP8Buffer(100, 100);
    const result = detectMimeType(buf);
    expect(result).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("detects AVIF from magic bytes", () => {
    const buf = createAvifBuffer(100, 100);
    const result = detectMimeType(buf);
    expect(result).toEqual({ mime: "image/avif", ext: "avif" });
  });

  it("returns null for unknown file types", () => {
    const buf = Buffer.from("not an image file at all");
    const result = detectMimeType(buf);
    expect(result).toBeNull();
  });

  it("returns null for empty buffer", () => {
    const buf = Buffer.alloc(0);
    const result = detectMimeType(buf);
    expect(result).toBeNull();
  });

  it("returns null for too-short buffer", () => {
    const buf = Buffer.from([0x89, 0x50]); // Partial PNG signature
    const result = detectMimeType(buf);
    expect(result).toBeNull();
  });

  it("rejects WebP-like buffer without WEBP marker at offset 8", () => {
    const buf = Buffer.alloc(12);
    buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    buf.writeUInt32LE(4, 4);
    buf.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI " instead of "WEBP"
    const result = detectMimeType(buf);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: getImageDimensions
// ---------------------------------------------------------------------------

describe("getImageDimensions", () => {
  it("reads PNG dimensions correctly", () => {
    const result = getImageDimensions(createPngBuffer(512, 256), "image/png");
    expect(result).toEqual({ width: 512, height: 256 });
  });

  it("reads JPEG dimensions correctly", () => {
    const result = getImageDimensions(createJpegBuffer(800, 600), "image/jpeg");
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP VP8 dimensions correctly", () => {
    const result = getImageDimensions(createWebpVP8Buffer(320, 240), "image/webp");
    expect(result).toEqual({ width: 320, height: 240 });
  });

  it("reads AVIF dimensions from ispe box", () => {
    const result = getImageDimensions(createAvifBuffer(1920, 1080), "image/avif");
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it("returns null for unknown MIME type", () => {
    const buf = Buffer.alloc(100);
    const result = getImageDimensions(buf, "image/gif");
    expect(result).toBeNull();
  });

  it("returns null for too-short PNG buffer", () => {
    const buf = Buffer.alloc(10);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const result = getImageDimensions(buf, "image/png");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: generateFilename
// ---------------------------------------------------------------------------

describe("generateFilename", () => {
  it("generates logo filenames in logos/ folder", () => {
    const filename = generateFilename("logo", "png");
    expect(filename).toMatch(/^logos\/\d+-[a-f0-9]{16}\.png$/);
  });

  it("generates favicon filenames in favicons/ folder", () => {
    const filename = generateFilename("favicon", "jpg");
    expect(filename).toMatch(/^favicons\/\d+-[a-f0-9]{16}\.jpg$/);
  });

  it("generates unique filenames on consecutive calls", () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(generateFilename("logo", "png"));
    }
    expect(names.size).toBe(100);
  });

  it("preserves the provided extension", () => {
    const filename = generateFilename("logo", "webp");
    expect(filename).toMatch(/\.webp$/);
  });
});
