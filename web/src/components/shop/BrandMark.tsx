import { useEffect, useState } from "react";
import * as api from "../../lib/api";

/**
 * THE product-brand logo renderer — used by every storefront surface that
 * shows a brand's mark (homepage Shop by Brand, the All Brands page, the brand
 * page header, product detail, admin preview), so they all behave the same.
 *
 * - Uploaded logo → shown as-is, EXCEPT a logo the backend classified as
 *   `tone: "light"` (a white/near-white mark on transparency — see
 *   api/src/lib/security/image-tone.ts) is rendered as a dark silhouette on
 *   light surfaces so it never disappears. The stored file is untouched; this
 *   is a presentation-only CSS treatment. Dark/unknown logos are never
 *   altered on light surfaces.
 * - `surface="photo"` (Shop by Brand card with a campaign photo): only the
 *   mark shows over the photo, never a box. A light logo (white on
 *   transparency) is shown as-is. Any other logo is knocked out: inverted to
 *   white-on-black and screen-blended, so its own background (white box,
 *   JPG background) disappears and the mark reads white. Plainly recolouring
 *   such a logo white (the old treatment) turned it into a blank rectangle.
 * - No logo, or the image fails to load → the brand name as a wordmark, and
 *   the failing URL is reported to the console so a broken path is visible
 *   instead of silently hidden.
 */
export function BrandMark({
  brand,
  surface = "light",
  className = "",
  wordmarkClassName = "",
  alt,
  fallback,
}: {
  brand: Pick<api.Brand, "name" | "logo">;
  surface?: "light" | "photo";
  className?: string;
  wordmarkClassName?: string;
  /** Defaults to "<name> logo"; pass "" when the brand name is already announced nearby. */
  alt?: string;
  /** Text shown when there's no usable logo (defaults to the brand name). */
  fallback?: string;
}) {
  const url = brand.logo?.url ? api.assetUrl(brand.logo.url) : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return <span className={`brandWordmark ${wordmarkClassName}`.trim()}>{fallback ?? brand.name}</span>;
  }
  const tone = brand.logo?.tone ?? null;
  const treatment =
    surface === "photo"
      ? tone === "light" ? "brandMarkImg--onPhoto" : "brandMarkImg--knockout"
      : tone === "light" ? "brandMarkImg--lightOnLight" : "";
  return (
    <img
      src={url}
      alt={alt ?? `${brand.name} logo`}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-tone={tone ?? "unknown"}
      className={`brandMarkImg ${treatment} ${className}`.trim()}
      onError={() => {
        console.warn(`Brand logo failed to load for "${brand.name}": ${url}`);
        setFailed(true);
      }}
    />
  );
}
