import { withRoute, applySecurityHeaders } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getPlatformSettings } from "@/lib/services/platform-settings.service";
import { config } from "@/lib/config";
import { NextResponse } from "next/server";

/**
 * Dynamically generated Web App Manifest — served from the API rather
 * than a static file, so it reflects whatever the Superadmin has
 * actually configured (app name, icon) with no separate manifest to
 * remember to update. index.html points its <link rel="manifest"> here.
 *
 * The icon falls back in three steps, never to a hardcoded old-brand
 * icon: the Superadmin-uploaded PWA icon -> the platform logo (if no
 * PWA-specific icon was uploaded yet) -> omitted entirely (a browser
 * simply won't offer installation without a valid icon, which is the
 * correct behavior per this feature's own "don't show install when it
 * can't work" requirement, rather than fabricating a placeholder image).
 *
 * Theme/background color are fixed to the site's own black/white brand
 * palette here rather than separate admin-configurable settings — see
 * migration 0038's header comment for why.
 */
export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const settings = await getPlatformSettings();
  const iconUrl = settings.pwaIconUrl ?? settings.logoUrl;
  // A real bug this fixes: PWA icon uploads accept PNG/JPEG/WebP (the
  // same shared upload validation every image upload uses — see
  // security/image.ts), but this route previously hardcoded
  // "image/png" for every icon entry regardless of what was actually
  // uploaded. A JPEG or WebP icon would then be declared as PNG in the
  // manifest, which browsers correctly refuse to use — the installed
  // icon silently falls back to a generic one, with no visible error
  // anywhere. logoUrl (the fallback icon source when no PWA-specific
  // icon exists) has no equivalent content-type field, so it falls
  // back to PNG only in that specific case — logos are conventionally
  // uploaded as PNG for transparency, making this a reasonable default
  // rather than a guess with no basis.
  const iconType = settings.pwaIconUrl ? settings.pwaIconContentType ?? "image/png" : "image/png";

  const manifest: Record<string, unknown> = {
    name: settings.platformName,
    short_name: settings.platformName,
    description: settings.tagline || `Shop ${settings.platformName} — fashion for every side of your style.`,
    display: "standalone",
    start_url: "/",
    scope: "/",
    theme_color: "#111111",
    background_color: "#ffffff",
    icons: [] as Array<Record<string, unknown>>,
  };

  if (iconUrl) {
    // iconUrl is a root-relative path (e.g. "/uploads/branding/x.png") served
    // by the API origin. The manifest itself is now loaded same-origin with the
    // page (see index.html + vite proxy) so that start_url/scope are honoured,
    // which means a root-relative icon would resolve against the *frontend*
    // origin and 404. Make it absolute against the API origin instead — the
    // same origin every other uploaded asset (logo, product images) is served
    // from via the storefront's assetUrl() helper.
    const iconSrc = /^https?:\/\//i.test(iconUrl)
      ? iconUrl
      : `${config.appUrl.replace(/\/$/, "")}${iconUrl.startsWith("/") ? "" : "/"}${iconUrl}`;
    // A single source image serves every requested size — browsers scale
    // it as needed for a "sizes":"any" declaration. This avoids the
    // multi-file icon-generation pipeline the source document flags as
    // "only if the architecture specifically requires it": it doesn't
    // here, since every modern installing browser handles one
    // reasonably large source icon correctly.
    (manifest.icons as Array<Record<string, unknown>>).push(
      { src: iconSrc, sizes: "any", type: iconType, purpose: "any" },
      { src: iconSrc, sizes: "any", type: iconType, purpose: "maskable" }
    );
  }

  const res = new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json",
      // Short cache — long enough to avoid re-fetching on every page
      // load, short enough that an admin's icon/name change is picked
      // up quickly rather than needing a hard cache-bust.
      "Cache-Control": "public, max-age=300",
    },
  });
  // This route builds its own NextResponse (rather than the json() helper)
  // specifically for the non-JSON Content-Type above — but every other
  // route in this app gets the same baseline security headers via json(),
  // and there's no reason a manifest response should be the one exception
  // to that. Reuses the exact same header-setting logic rather than
  // duplicating the list here.
  return applySecurityHeaders(res);
});
