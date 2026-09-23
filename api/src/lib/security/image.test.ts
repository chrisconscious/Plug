import { describe, it, expect } from "vitest";
import { inspectImage, ImageValidationError, stripImageMetadata } from "./image";

function makePng(width: number, height: number, opts: { truncate?: boolean } = {}): Buffer {
  const buf = Buffer.alloc(opts.truncate ? 10 : 24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  if (!opts.truncate) {
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
  }
  return buf;
}

describe("inspectImage — security: content inspection, never trusting filename/extension/Content-Type", () => {
  it("rejects an empty file", () => {
    expect(() => inspectImage(Buffer.alloc(0))).toThrow(ImageValidationError);
  });

  it("rejects a renamed executable (Windows PE 'MZ' header) despite any claimed extension/MIME type", () => {
    // inspectImage() takes ONLY bytes — there is no content-type/filename
    // parameter to fool. This is a real PE header prefix.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    expect(() => inspectImage(exe)).toThrow(/Unsupported file type/);
  });

  it("rejects a renamed ELF executable the same way", () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(() => inspectImage(elf)).toThrow(/Unsupported file type/);
  });

  it("rejects arbitrary text/script content with no image signature at all", () => {
    const script = Buffer.from("#!/bin/sh\nrm -rf /\n", "utf8");
    expect(() => inspectImage(script)).toThrow(/Unsupported file type/);
  });

  it("rejects SVG explicitly (XML that can carry scripts — a stored-XSS risk if ever served inline)", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
    expect(() => inspectImage(svg)).toThrow(/Unsupported file type/);
  });

  it("rejects a corrupt/truncated PNG (valid signature, header cut off)", () => {
    expect(() => inspectImage(makePng(0, 0, { truncate: true }))).toThrow(/truncated/);
  });

  it("rejects a malformed JPEG (valid SOI marker, no locatable SOF/dimensions)", () => {
    // JFIF APP0 marker only — a real (if unusual) way a JPEG-like byte
    // stream can fail to yield dimensions.
    const badJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    expect(() => inspectImage(badJpeg)).toThrow(ImageValidationError);
  });

  it("rejects a JPEG-signature buffer that's just random garbage after the SOI marker", () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(Array(50).fill(0xaa))]);
    expect(() => inspectImage(corrupt)).toThrow(ImageValidationError);
  });

  it("rejects a malformed WebP (valid RIFF/WEBP container, unrecognized chunk type)", () => {
    const badWebp = Buffer.alloc(30);
    badWebp.write("RIFF", 0, "ascii");
    badWebp.writeUInt32LE(22, 4);
    badWebp.write("WEBP", 8, "ascii");
    badWebp.write("XXXX", 12, "ascii"); // not VP8X/VP8 /VP8L
    expect(() => inspectImage(badWebp)).toThrow(/Unsupported WebP variant/);
  });

  it("rejects a truncated WebP (RIFF header present but too short to contain a real chunk)", () => {
    const truncated = Buffer.from("RIFF\x00\x00\x00\x00WEBP", "ascii");
    expect(() => inspectImage(truncated)).toThrow(ImageValidationError);
  });

  it("rejects an oversized image (dimensions beyond the per-side maximum) before any pixel data would ever be processed", () => {
    // 50000x50000 — declared in the header only; this validator never
    // decodes pixel data, so this proves the guard is dimension-based,
    // not a timeout/memory-limit caught after the fact.
    expect(() => inspectImage(makePng(50000, 50000))).toThrow(/too large/);
  });

  it("rejects an image whose total pixel count exceeds the cap even if no single side does (a thin, extremely long image)", () => {
    // 9000 x 9000 = 81,000,000 pixels — over the 40M cap despite each side
    // individually being under the 10,000px per-side maximum. Proves the
    // pixel-count check is independent of the per-side check.
    expect(() => inspectImage(makePng(9000, 9000))).toThrow(/too many total pixels/);
  });

  it("rejects a degenerate near-zero-size image (e.g. a 1x1 tracking-pixel-style upload)", () => {
    expect(() => inspectImage(makePng(1, 1))).toThrow(/too small/);
  });

  it("accepts a normal, real-world product-photo-sized image", () => {
    const info = inspectImage(makePng(1600, 2000));
    expect(info.width).toBe(1600);
    expect(info.height).toBe(2000);
    expect(info.contentType).toBe("image/png");
  });

  it("the 'huge decompression workload' case: a file whose header claims an enormous canvas is rejected BEFORE any decompression is attempted (this validator never calls a decoder — the file itself can be tiny)", () => {
    // The whole point: the file is 24 bytes, but its header claims a
    // canvas that would require ~10GB to decode as raw RGBA. It must be
    // rejected on the declared dimensions alone.
    const tinyFileHugeClaim = makePng(60000, 60000);
    expect(tinyFileHugeClaim.length).toBe(24); // the attack: tiny file, huge claimed canvas
    expect(() => inspectImage(tinyFileHugeClaim)).toThrow(/too large/);
  });
});

describe("stripImageMetadata — EXIF/text-chunk removal", () => {
  function u16(n: number): number[] { return [(n >> 8) & 0xff, n & 0xff]; }
  function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }
  const FAKE_CRC = Buffer.from([0, 0, 0, 0]); // CRC correctness is irrelevant to this module — it never validates CRCs, only chunk/segment framing

  function makeRealJpegWithExif(): Buffer {
    const app0Data = Buffer.from("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00");
    const app0 = Buffer.from([0xff, 0xe0, ...u16(app0Data.length + 2), ...app0Data]);
    const exifData = Buffer.from("Exif\x00\x00FAKE_GPS_LOCATION_DATA_1234567890");
    const app1 = Buffer.from([0xff, 0xe1, ...u16(exifData.length + 2), ...exifData]);
    const sof0Data = Buffer.from([0x08, 0x00, 150, 0x00, 200, 0x01, 0x01, 0x11, 0x00]);
    const sof0 = Buffer.from([0xff, 0xc0, ...u16(sof0Data.length + 2), ...sof0Data]);
    const sos = Buffer.from([0xff, 0xda]);
    const scanData = Buffer.from(Array(20).fill(0x55));
    const eoi = Buffer.from([0xff, 0xd9]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, app1, sof0, sos, scanData, eoi]);
  }

  function makeRealPngWithTextChunk(): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(800, 0);
    ihdrData.writeUInt32BE(600, 4);
    const ihdr = Buffer.concat([u32(13), Buffer.from("IHDR"), ihdrData, FAKE_CRC]);
    const textData = Buffer.from("Author\x00Jane Doe — GPS:1.23,4.56");
    const text = Buffer.concat([u32(textData.length), Buffer.from("tEXt"), textData, FAKE_CRC]);
    const idatData = Buffer.from(Array(10).fill(0x42));
    const idat = Buffer.concat([u32(idatData.length), Buffer.from("IDAT"), idatData, FAKE_CRC]);
    const iend = Buffer.concat([u32(0), Buffer.from("IEND"), FAKE_CRC]);
    return Buffer.concat([sig, ihdr, text, idat, iend]);
  }

  it("removes the EXIF (APP1) segment from a JPEG while preserving JFIF, SOF0, scan data, and EOI", () => {
    const original = makeRealJpegWithExif();
    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(stripped.includes(Buffer.from("FAKE_GPS_LOCATION_DATA"))).toBe(false);
    expect(stripped.includes(Buffer.from("JFIF"))).toBe(true);
    expect(stripped.includes(Buffer.from([0xff, 0xc0]))).toBe(true); // SOF0 marker
    expect(stripped[stripped.length - 2]).toBe(0xff);
    expect(stripped[stripped.length - 1]).toBe(0xd9); // EOI
    expect(stripped.length).toBeLessThan(original.length);
  });

  it("removes tEXt chunks from a PNG while preserving IHDR, IDAT, and IEND", () => {
    const original = makeRealPngWithTextChunk();
    const stripped = stripImageMetadata(original, "image/png");
    expect(stripped.includes(Buffer.from("Jane Doe"))).toBe(false);
    expect(stripped.includes(Buffer.from("IHDR"))).toBe(true);
    expect(stripped.includes(Buffer.from("IDAT"))).toBe(true);
    expect(stripped.includes(Buffer.from("IEND"))).toBe(true);
    // Dimensions must still be readable at the same byte offsets — this
    // module must never touch pixel-defining data, only metadata chunks.
    expect(stripped.readUInt32BE(16)).toBe(800);
    expect(stripped.readUInt32BE(20)).toBe(600);
  });

  it("leaves a minimal PNG with no CRC/IEND (e.g. this test suite's own fixtures) completely untouched rather than truncating it", () => {
    // Regression test for a real bug caught while building this: a PNG
    // chunk with no trailing CRC looks "incomplete" by strict chunk-length
    // accounting, and an earlier version of this function silently dropped
    // everything after the signature in that case.
    const minimal = makePng(800, 600);
    const stripped = stripImageMetadata(minimal, "image/png");
    expect(stripped.equals(minimal)).toBe(true);
  });

  it("is a no-op for WebP (explicitly out of scope — see module note)", () => {
    const webp = Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 extra-bytes-here", "ascii");
    const result = stripImageMetadata(webp, "image/webp");
    expect(result.equals(webp)).toBe(true);
  });
});
