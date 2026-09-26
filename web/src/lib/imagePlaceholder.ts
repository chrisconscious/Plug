import { assetUrl } from "./api";

/**
 * Hosts known to be unreliable for serving product imagery. The storefront was
 * seeded (115/118 product-image rows) with URLs on this external host, which
 * intermittently 200s and intermittently times out. Because `onError` does not
 * fire promptly on a stalled connection, cards can appear image-less for a long
 * time. We short-circuit these known-flaky hosts up front so every card renders
 * a stable placeholder instantly instead of hanging on a timeout.
 */
const KNOWN_FLAKY_HOSTS: string[] = ["storage.googleapis.com", "uxpilot-auth.appspot.com"];

/**
 * Self-contained placeholder encoded as a data-URI so it is bundled with the
 * app and never depends on a network round-trip. Deliberately a plain,
 * labelled neutral tile — NOT a garment drawing — so a missing/failed image
 * can never be mistaken for a real product photo. (Publishing a product
 * requires at least one uploaded image, so live products only show this if an
 * image fails to load.)
 */
export const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="#efeeeb"/>
      <text x="300" y="410" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="6" fill="#b9b6b0">NO IMAGE</text>
    </svg>`
  );

function looksFlaky(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN_FLAKY_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * Resolve an image URL to a displayable src. Returns a self-hosted asset when
 * the URL is relative, the stable placeholder when the URL points to a
 * known-flaky external host, or the URL itself otherwise.
 */
export function resolveImage(url?: string | null): string {
  if (!url) return PLACEHOLDER_IMG;
  const resolved = assetUrl(url);
  if (!resolved) return PLACEHOLDER_IMG;
  if (looksFlaky(resolved)) return PLACEHOLDER_IMG;
  return resolved;
}
