/**
 * Logo tone detection — decides whether an uploaded logo is a LIGHT mark
 * (e.g. a white logo on a transparent background) that would disappear on
 * the storefront's light surfaces.
 *
 * The original upload is never modified: the result is stored as metadata
 * (brand_logos.tone, migration 0054) and the storefront renders light logos
 * with a dark treatment on light backgrounds (see web BrandMark).
 *
 * Dependency-free on purpose (this API ships no image library): PNG is
 * decoded with Node's zlib + the PNG filter reconstruction below. PNG is the
 * format that carries transparency — and transparency is exactly what makes
 * a white logo invisible. JPEG has no alpha (a white JPEG logo carries its
 * own opaque background, so it stays visible); WebP/other formats return
 * null ("unknown") and admins can set the tone manually.
 */
import { inflateSync } from "zlib";

export type LogoTone = "light" | "dark";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 25_000_000;

type Rgba = (x: number, y: number) => [number, number, number, number];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a non-interlaced PNG into an RGBA sampler, or null if unsupported/corrupt. */
export function decodePng(buf: Buffer): { width: number; height: number; at: Rgba } | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (data.length !== len) return null;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!width || !height || width * height > MAX_PIXELS || interlace !== 0 || idat.length === 0) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (colorType === 3 && !palette) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // bytes per pixel for filtering
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < height * (stride + 1)) return null;

  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? px[dst + i - bpp]! : 0;
      const b = y > 0 ? px[dst - stride + i]! : 0;
      const c = y > 0 && i >= bpp ? px[dst - stride + i - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: return null;
      }
      px[dst + i] = v & 0xff;
    }
  }

  const sample = (y: number, x: number, ch: number): number => {
    const row = y * stride;
    if (bitDepth === 8) return px[row + x * channels + ch]!;
    if (bitDepth === 16) return px[row + (x * channels + ch) * 2]!; // high byte
    const perByte = 8 / bitDepth;
    const idx = x * channels + ch;
    const byte = px[row + Math.floor(idx / perByte)]!;
    const shift = 8 - bitDepth * ((idx % perByte) + 1);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  const scale = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1;

  const at: Rgba = (x, y) => {
    switch (colorType) {
      case 0: {
        const g = sample(y, x, 0);
        const transparent = trns && trns.length >= 2 && g === (bitDepth === 16 ? trns[0]! : trns.readUInt16BE(0));
        return [g * scale, g * scale, g * scale, transparent ? 0 : 255];
      }
      case 2: {
        const r = sample(y, x, 0), g = sample(y, x, 1), b = sample(y, x, 2);
        const transparent =
          trns && trns.length >= 6 && bitDepth === 8 && r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && b === trns.readUInt16BE(4);
        return [r, g, b, transparent ? 0 : 255];
      }
      case 3: {
        const i = sample(y, x, 0);
        const p = palette!;
        return [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0, trns && i < trns.length ? trns[i]! : 255];
      }
      case 4: {
        const g = sample(y, x, 0);
        return [g, g, g, sample(y, x, 1)];
      }
      default:
        return [sample(y, x, 0), sample(y, x, 1), sample(y, x, 2), sample(y, x, 3)];
    }
  };
  return { width, height, at };
}

/**
 * "light" only when the logo has real transparency AND its visible pixels
 * are overwhelmingly near-white — i.e. it would vanish on a light surface.
 * An opaque logo (its own background) is always "dark": it's visible as-is,
 * and darkening it would turn its background into a black box.
 */
export function analyzeLogoTone(buf: Buffer, contentType: string): LogoTone | null {
  if (contentType !== "image/png") return contentType === "image/jpeg" ? "dark" : null;
  const img = decodePng(buf);
  if (!img) return null;
  // Sample on a grid (≤ ~40k points) — plenty for a tone decision.
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 40_000)));
  let total = 0, transparent = 0, visible = 0, light = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      total++;
      const [r, g, b, a] = img.at(x, y);
      if (a < 32) { transparent++; continue; }
      visible++;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum >= 0.82) light++;
    }
  }
  if (visible === 0) return null;
  const hasTransparency = transparent / total >= 0.05;
  if (!hasTransparency) return "dark";
  return light / visible >= 0.85 ? "light" : "dark";
}
