import { describe, it, expect } from "vitest";
import { deflateSync } from "zlib";
import { analyzeLogoTone, decodePng } from "./image-tone";

/** Minimal PNG encoder for tests (CRCs are zeroed — the decoder doesn't verify them). */
function png(width: number, height: number, colorType: 6 | 4, pixel: (x: number, y: number) => number[], filter: 0 | 1 | 4 = 0): Buffer {
  const ch = colorType === 6 ? 4 : 2;
  const stride = width * ch;
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(...pixel(x, y));
    rows.push(row);
  }
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(filter);
    for (let i = 0; i < stride; i++) {
      const cur = rows[y]![i]!;
      const a = i >= ch ? rows[y]![i - ch]! : 0;
      const b = y > 0 ? rows[y - 1]![i]! : 0;
      const c = y > 0 && i >= ch ? rows[y - 1]![i - ch]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw.push((cur - pred + 256) & 0xff);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A "logo": a filled rectangle in the middle, transparent (or opaque bg) around it. */
const logo = (fg: number[], bg: number[]) => (x: number, y: number) => (x > 10 && x < 50 && y > 10 && y < 30 ? fg : bg);

describe("analyzeLogoTone", () => {
  it("flags a white logo on transparency as light", () => {
    expect(analyzeLogoTone(png(60, 40, 6, logo([255, 255, 255, 255], [0, 0, 0, 0])), "image/png")).toBe("light");
  });

  it("keeps a black logo on transparency dark", () => {
    expect(analyzeLogoTone(png(60, 40, 6, logo([10, 10, 10, 255], [0, 0, 0, 0])), "image/png")).toBe("dark");
  });

  it("keeps an OPAQUE logo dark even if its background is white (it is visible as-is)", () => {
    expect(analyzeLogoTone(png(60, 40, 6, logo([20, 20, 20, 255], [255, 255, 255, 255])), "image/png")).toBe("dark");
    expect(analyzeLogoTone(png(60, 40, 6, () => [255, 255, 255, 255]), "image/png")).toBe("dark");
  });

  it("treats a mostly-white mark with a small dark detail as light", () => {
    const px = (x: number, y: number) => (x > 10 && x < 50 && y > 10 && y < 30 ? (x === 30 ? [0, 0, 0, 255] : [250, 250, 250, 255]) : [0, 0, 0, 0]);
    expect(analyzeLogoTone(png(60, 40, 6, px), "image/png")).toBe("light");
  });

  it("decodes Sub- and Paeth-filtered rows and grayscale+alpha", () => {
    expect(analyzeLogoTone(png(60, 40, 6, logo([255, 255, 255, 255], [0, 0, 0, 0]), 1), "image/png")).toBe("light");
    expect(analyzeLogoTone(png(60, 40, 6, logo([240, 240, 240, 255], [0, 0, 0, 0]), 4), "image/png")).toBe("light");
    expect(analyzeLogoTone(png(60, 40, 4, logo([255, 255], [0, 0])), "image/png")).toBe("light");
    const d = decodePng(png(3, 2, 6, (x, y) => [x * 10, y * 20, 7, 255], 4))!;
    expect(d.at(2, 1)).toEqual([20, 20, 7, 255]);
  });

  it("returns null for unknown/corrupt data and 'dark' for JPEG (no transparency)", () => {
    expect(analyzeLogoTone(Buffer.from("not a png"), "image/png")).toBeNull();
    expect(analyzeLogoTone(Buffer.alloc(10), "image/webp")).toBeNull();
    expect(analyzeLogoTone(Buffer.alloc(10), "image/jpeg")).toBe("dark");
  });
});
