import { useEffect, useState } from "react";
import * as api from "../../lib/api";

/**
 * THE product-brand logo renderer — used by every storefront surface that
 * shows a brand's mark (homepage Shop by Brand, the All Brands page, the brand
 * page header, product detail, admin preview), so they all behave the same.
 *
 * - Uploaded logo → shown exactly as uploaded, on every surface: its own
 *   colours and background, never recoloured, inverted or blended; only
 *   scaled (object-fit: contain) to fit the space the surface gives it.
 * - No logo, or the image fails to load → the brand name as a wordmark, and
 *   the failing URL is reported to the console so a broken path is visible
 *   instead of silently hidden.
 */
export function BrandMark({
  brand,
  className = "",
  wordmarkClassName = "",
  alt,
  fallback,
}: {
  brand: Pick<api.Brand, "name" | "logo">;
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
  return (
    <img
      src={url}
      alt={alt ?? `${brand.name} logo`}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`brandMarkImg ${className}`.trim()}
      onError={() => {
        console.warn(`Brand logo failed to load for "${brand.name}": ${url}`);
        setFailed(true);
      }}
    />
  );
}
