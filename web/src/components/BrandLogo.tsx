import { useEffect, useState } from 'react';
import { usePlatformSettings } from '../lib/PlatformSettingsContext';
import * as api from '../lib/api';

/**
 * Placement variants that get CSS-driven, viewport-responsive sizing
 * instead of a fixed pixel height (see index.css `.plug-brand-logo--*`):
 * the storefront header and footer wordmark span every device width, so a
 * fixed `maxHeight` would leave them oversized on phones or undersized on
 * 4K. The `default` variant keeps the classic fixed-pixel behavior for
 * small fixed-context spots (auth pages, Backoffice, the mobile nav
 * drawer) that never change width.
 */
type BrandLogoVariant = "default" | "header" | "footer";

/**
 * The ONE brand-logo rendering path used everywhere branding appears
 * (header, footer, auth pages, checkout, etc.) — per the requirement that
 * no developer should need to touch header.tsx/footer.tsx/checkout.tsx
 * individually to change branding, and that the wordmark must never be
 * stretched/cropped/distorted.
 *
 * - `maxHeight` controls the rendered size for the `default` variant;
 *   width is always automatic (`height: ..., width: 'auto'`) so the
 *   logo's real aspect ratio is preserved — this is what "never stretch
 *   a wordmark" means in CSS terms: never force both dimensions
 *   independently. `header`/`footer` variants size via CSS `clamp()` so
 *   the same asset scales cleanly from 320px phones to large desktops.
 * - Falls back to plain text (the configured platform name — 'PLUG' by
 *   default) until a logo is uploaded. Once Super Admin uploads one,
 *   every consumer of this component switches automatically — nothing
 *   here is hardcoded to 'PLUG' as a string baked into markup; it comes
 *   from PlatformSettingsContext, which is itself driven by the
 *   database-backed platform_settings row (see migration 0029).
 * - A logo that fails to load (e.g. the asset was removed server-side)
 *   falls back to the same text wordmark instead of rendering a broken
 *   image icon — visibility is checked on `onError` and re-tested any
 *   time `logoUrl` changes.
 */
export function BrandLogo({ maxHeight = 28, variant = "default", className }: { maxHeight?: number; variant?: BrandLogoVariant; className?: string }) {
  const { platformName, logoUrl } = usePlatformSettings();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logoUrl]);

  if (logoUrl && !failed) {
    const responsive = variant !== "default";
    return (
      <img
        src={api.assetUrl(logoUrl)}
        alt={`${platformName} wordmark`}
        className={["plug-brand-logo", responsive && `plug-brand-logo--${variant}`, className].filter(Boolean).join(" ")}
        style={responsive ? undefined : { height: maxHeight, width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" }}
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className={["plug-brand-wordmark", variant !== "default" && `plug-brand-wordmark--${variant}`, className].filter(Boolean).join(" ")}>{platformName}</span>;
}
