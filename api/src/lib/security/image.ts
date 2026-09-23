/**
 * Zero-dependency image validation for uploads.
 *
 * We deliberately do NOT trust the client-supplied content type or filename
 * extension. Instead we sniff the actual bytes (magic numbers) and parse the
 * header dimensions directly for the small set of formats we support:
 *   - PNG
 *   - JPEG
 *   - WebP
 *
 * SVG is explicitly rejected: it is XML that can carry scripts, and serving
 * untrusted SVG inline is a stored-XSS risk we don't want to engineer around
 * (see docs/SECURITY.md "Image uploads").
 */

export type ImageInfo = {
  contentType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

function readUInt32BE(buf: Buffer, offset: number): number {
  return (
    buf[offset]! * 0x1000000 +
    ((buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!)
  );
}

/** Parses a PNG's IHDR (signature + 8-byte header gives width/height at bytes 16-23). */
function parsePng(buf: Buffer): ImageInfo {
  // Ensure we can read the full IHDR (24 bytes: 8 sig + 4 len + 4 type + 13 data).
  if (buf.length < 24) throw new ImageValidationError("PNG header is truncated.");
  const width = readUInt32BE(buf, 16);
  const height = readUInt32BE(buf, 20);
  if (width <= 0 || height <= 0) throw new ImageValidationError("PNG has invalid dimensions.");
  return { contentType: "image/png", width, height };
}

/** Parses a JPEG dimensions by scanning SOF0/SOF2 markers. */
function parseJpeg(buf: Buffer): ImageInfo {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new ImageValidationError("Not a valid JPEG.");
  }
  let offset = 2;
  const len = buf.length;
  while (offset + 9 < len) {
    if (buf[offset] !== 0xff) {
      // Skip entropy-coded data: not a marker start.
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // Standalone markers / RSTn have no length field.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      offset += 2;
      continue;
    }
    const segLen = (buf[offset + 2]! << 8) | buf[offset + 3]!;
    // SOF0 (baseline) / SOF2 (progressive): dimensions live in the segment.
    if (marker === 0xc0 || marker === 0xc2) {
      const height = (buf[offset + 5]! << 8) | buf[offset + 6]!;
      const width = (buf[offset + 7]! << 8) | buf[offset + 8]!;
      if (width <= 0 || height <= 0) throw new ImageValidationError("JPEG has invalid dimensions.");
      return { contentType: "image/jpeg", width, height };
    }
    offset += 2 + segLen;
  }
  throw new ImageValidationError("Could not locate JPEG dimensions (unexpected structure).");
}

/** Parses a WebP image (both lossy/lossless/alpha VP8x variants). */
function parseWebp(buf: Buffer): ImageInfo {
  // "RIFF" (12 bytes) + "WEBP" (4 bytes) at start.
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    throw new ImageValidationError("Not a valid WebP.");
  }
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // Extended: 24 or 30-byte header, canvas 24-bit at bytes 24-26 then 27-29.
    const width = 1 + ((buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)) & 0xffffff);
    const height = 1 + ((buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) & 0xffffff);
    return { contentType: "image/webp", width, height };
  }
  if (chunk === "VP8 " || chunk === "VP8L") {
    // VP8 lossy: frame header at offset 20..; VP8L: 14-bit codes at offset 21+.
    const width = ((buf[24]! | (buf[25]! << 8)) & 0x3fff);
    const height = ((buf[26]! | (buf[27]! << 8)) & 0x3fff);
    if (width <= 0 || height <= 0) throw new ImageValidationError("WebP has invalid dimensions.");
    return { contentType: "image/webp", width, height };
  }
  throw new ImageValidationError("Unsupported WebP variant.");
}

export class ImageValidationError extends Error {}

// Deliberately generous (real product/hero photography can be large) but
// bounded — the actual risk isn't THIS module (it only ever reads a
// handful of header bytes, never decodes pixel data, so it can't itself
// be decompression-bombed), it's every DOWNSTREAM consumer: a browser
// rendering the image has to allocate real memory proportional to
// width*height, and nothing stops an attacker from crafting a tiny file
// whose header simply CLAIMS an enormous canvas. Rejecting that here means
// no downstream consumer (a customer's browser, a future thumbnailing
// step, this app's own image tag) ever has to find out the hard way.
const MAX_PIXELS = 40_000_000; // ~6000x6666 — generous for product/hero photography
const MIN_DIMENSION = 8; // rejects degenerate 1x1-style spam/tracking-pixel uploads
const MAX_DIMENSION = 10_000; // bounds worst-case aspect-ratio abuse even under the pixel cap (e.g. 1x10,000,000 would pass a pixel-count-only check)

function assertDimensionsInBounds(info: ImageInfo): ImageInfo {
  if (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION) {
    throw new ImageValidationError(`Image is too small. Minimum dimension is ${MIN_DIMENSION}px on each side.`);
  }
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new ImageValidationError(`Image is too large. Maximum dimension is ${MAX_DIMENSION}px on each side.`);
  }
  if (info.width * info.height > MAX_PIXELS) {
    throw new ImageValidationError(`Image has too many total pixels (${info.width}x${info.height}). Maximum is ${MAX_PIXELS.toLocaleString()} pixels.`);
  }
  return info;
}

/**
 * Validates a raw uploaded buffer and returns its true type + dimensions.
 * Throws ImageValidationError on any mismatch/unsupported format.
 */
export function inspectImage(buf: Buffer): ImageInfo {
  if (!buf || buf.length === 0) throw new ImageValidationError("No file content provided.");

  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 && // P
    buf[2] === 0x4e && // N
    buf[3] === 0x47 && // G
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return assertDimensionsInBounds(parsePng(buf));
  }

  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return assertDimensionsInBounds(parseJpeg(buf));
  }

  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return assertDimensionsInBounds(parseWebp(buf));
  }

  // Reject everything else, including SVG (explicitly — see module docstring).
  throw new ImageValidationError(
    "Unsupported file type. Only PNG, JPEG, and WebP images are allowed."
  );
}

/**
 * Metadata stripping — privacy/security hardening for uploaded images.
 *
 * JPEG's EXIF data (APP1 segment) can carry GPS coordinates, camera serial
 * numbers, device identifiers, and timestamps — real privacy exposure for
 * a customer/admin who didn't realize their photo carried that. PNG's
 * text/time ancillary chunks (tEXt/zTXt/iTXt/eXIf/tIME) can carry the same
 * class of information (some PNG encoders embed EXIF too, or arbitrary
 * free-text comments).
 *
 * This is pure byte-level segment/chunk removal — it does NOT decode any
 * pixel data, so it can't itself be a decompression-bomb vector, and it
 * works without an image-processing library. Note the honest scope limit:
 * this removes the EXIF orientation TAG along with everything else in that
 * segment, rather than reading it and re-encoding the pixels rotated to
 * match (that would need a real decoder/encoder, e.g. `sharp`, which isn't
 * available in this environment). Stripping the tag is the safe, standard
 * conservative choice here: the image displays exactly as its pixels are
 * stored, with no auto-rotation applied by anything downstream — never
 * displayed sideways-but-differently by different viewers depending on
 * whether they honor the tag, which is itself a real, common source of
 * inconsistent-looking uploads.
 *
 * WebP is deliberately NOT covered here — its EXIF (when present) lives in
 * an optional RIFF sub-chunk in the extended VP8X format, a smaller/rarer
 * case among uploads than JPEG/PNG. Not implemented; noted rather than
 * silently ignored.
 */

function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf; // not a JPEG — leave untouched
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1]!;
    // SOS begins entropy-coded scan data with no further markers to parse
    // (aside from EOI at the very end) — copy everything remaining as-is;
    // there is nothing left to strip past this point.
    if (marker === 0xda) {
      out.push(buf.subarray(offset));
      offset = buf.length;
      break;
    }
    // Standalone markers (no length field): copy through unchanged.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const segLen = (buf[offset + 2]! << 8) | buf[offset + 3]!;
    const segEnd = offset + 2 + segLen;
    if (segEnd > buf.length) {
      // Same reasoning as stripPngMetadata's equivalent case: can no
      // longer reliably parse segment boundaries, so preserve what's left
      // untouched rather than silently drop it.
      out.push(buf.subarray(offset));
      break;
    }
    // APP1 is where EXIF lives (GPS/camera/orientation/timestamps). Drop
    // the whole segment; every other segment (APP0/JFIF, DQT, DHT, SOF,
    // etc.) is left untouched — those are structural, not metadata.
    if (marker !== 0xe1) {
      out.push(buf.subarray(offset, segEnd));
    }
    offset = segEnd;
  }
  return Buffer.concat(out);
}

function stripPngMetadata(buf: Buffer): Buffer {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return buf; // not a PNG
  const STRIP_CHUNK_TYPES = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const out: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const dataLen = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const chunkTotalLen = 8 + dataLen + 4; // length field + type + data + CRC
    if (offset + chunkTotalLen > buf.length) {
      // A chunk claims to extend past the buffer — this shouldn't happen
      // in a well-formed PNG, but the safe response to "can no longer
      // reliably parse chunk boundaries" is to preserve what's left
      // untouched, not silently drop it. Whatever validated this file
      // upstream (inspectImage) is the source of truth on whether it's
      // actually a valid PNG; this function's job is only to remove
      // specific metadata chunks when it can safely identify them.
      out.push(buf.subarray(offset));
      break;
    }
    if (!STRIP_CHUNK_TYPES.has(type)) {
      out.push(buf.subarray(offset, offset + chunkTotalLen));
    }
    offset += chunkTotalLen;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

/** Applies the appropriate metadata stripping for the given content type. Call AFTER inspectImage() has already validated the file — this trusts the caller to have confirmed it's a real, well-formed image of that type. */
export function stripImageMetadata(buf: Buffer, contentType: ImageInfo["contentType"]): Buffer {
  if (contentType === "image/jpeg") return stripJpegMetadata(buf);
  if (contentType === "image/png") return stripPngMetadata(buf);
  return buf; // WebP — not covered, see module note above
}
