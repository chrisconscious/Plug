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
 * app and never depends on a network round-trip (external fallbacks such as
 * Unsplash are, ironically, as unreliable as the images they replace).
 */
export const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="#ececea"/>
      <g fill="none" stroke="#c9c7c3" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <path d="M150 250 L200 600 L250 620 L280 380 L320 620 L370 600 L420 250"/>
        <rect x="180" y="200" width="150" height="40" rx="20"/>
        <circle cx="300" cy="150" r="34"/>
      </g>
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
