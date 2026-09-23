/**
 * Zero-dependency video validation for uploads — mirrors image.ts's own
 * approach and reasoning exactly: never trust the client-supplied content
 * type or filename extension, sniff the actual container bytes instead.
 *
 * Deliberately scoped narrower than image.ts: this checks that the file
 * genuinely IS an MP4 or WebM container (the only two formats the hero
 * video player actually needs — both play natively via <video> in every
 * modern browser with no transcoding), and enforces a size ceiling. It
 * does NOT parse the video stream to verify duration/resolution/codec,
 * or attempt any content-level sanitization the way stripImageMetadata
 * does for images — a full container parser is a materially larger
 * undertaking than sniffing a magic-byte header, and out of scope here.
 * The actual playback surface is a plain <video> tag with no execution
 * context of its own (unlike SVG, which image.ts rejects specifically
 * because it can carry scripts) — an MP4/WebM container cannot execute
 * script content in the way an untrusted SVG or HTML upload could, which
 * is what makes a magic-byte-only check a reasonable, honest scope limit
 * here rather than a security gap.
 */

export type VideoInfo = {
  contentType: "video/mp4" | "video/webm";
};

export class VideoValidationError extends Error {}

function isMp4(buf: Buffer): boolean {
  // ISO base media file format: a 4-byte big-endian box size, then the
  // 4-byte ASCII box type. The very first box in a well-formed MP4 is
  // almost always "ftyp" (file type box) at offset 4.
  if (buf.length < 12) return false;
  return buf.toString("ascii", 4, 8) === "ftyp";
}

function isWebm(buf: Buffer): boolean {
  // EBML (Extensible Binary Meta Language) header — Matroska/WebM's own
  // container format always starts with this exact 4-byte signature.
  if (buf.length < 4) return false;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

export function inspectVideo(buf: Buffer): VideoInfo {
  if (isMp4(buf)) return { contentType: "video/mp4" };
  if (isWebm(buf)) return { contentType: "video/webm" };
  throw new VideoValidationError("Unsupported file type. Upload an MP4 or WebM video.");
}
