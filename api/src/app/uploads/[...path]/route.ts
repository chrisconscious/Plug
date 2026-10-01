import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { inspectImage } from "@/lib/security/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves locally stored uploads (STORAGE_PROVIDER=local) at /uploads/<subdir>/<key>.
 *
 * `next start` only serves files that were already in public/ when the server
 * started, so a product image an admin uploads in production 404s until the
 * next restart. Files Next.js does know about are still served statically
 * before this route runs; everything else is read from the uploads directory
 * here, at request time.
 *
 * Only plain path segments are accepted (no "..", no hidden files), the
 * resolved path must stay inside the uploads directory, and only files that
 * really are PNG/JPEG/WebP images (checked from their bytes, like uploads
 * themselves) are returned, with their true content type.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function uploadsRoot(): string {
  return resolve(config.uploads.dir || resolve(process.cwd(), "public", "uploads"));
}

function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (config.storage.provider !== "local") return notFound();
  const { path } = await params;
  if (!Array.isArray(path) || path.length === 0 || path.length > 4 || !path.every((s) => SEGMENT.test(s))) return notFound();

  const root = uploadsRoot();
  const full = resolve(root, ...path);
  if (!full.startsWith(root + sep)) return notFound();

  let data: Buffer;
  try {
    data = await readFile(full);
  } catch {
    return notFound();
  }
  let contentType: string;
  try {
    contentType = inspectImage(data).contentType;
  } catch {
    return notFound();
  }
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      // Upload keys are fresh random ids and never rewritten in place.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
