/**
 * Secure "return to where I was" handling for sign-in redirects.
 *
 * The destination travels as `/login?returnTo=<path>` and is ONLY ever an
 * internal path of this app. Anything else — absolute URLs, protocol-relative
 * `//host`, backslash tricks (`/\\host`), `javascript:`, control characters,
 * or a loop back into the auth pages — is rejected, so the parameter can't be
 * used as an open redirect.
 *
 * Checkout state is never put in the URL beyond what the checkout page already
 * uses (`/checkout?buyNow=<variantId>&qty=<n>` — non-sensitive ids). Cart
 * contents live server-side on the customer's account, so they survive sign-in
 * untouched and are never duplicated.
 */
const AUTH_PAGES = /^\/(login|register|forgot-password|reset-password|verify-email)(\/|\?|#|$)/i;
const ORIGIN_PROBE = "https://return-to.invalid";

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 1024) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Control characters / whitespace inside a URL are never legitimate here.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  let url: URL;
  try {
    url = new URL(value, ORIGIN_PROBE);
  } catch {
    return null;
  }
  // Resolution must stay on the same (probe) origin — catches every
  // normalisation trick that would turn the path into another host.
  if (url.origin !== ORIGIN_PROBE) return null;
  const path = url.pathname + url.search + url.hash;
  if (AUTH_PAGES.test(path)) return null;
  return path;
}

/** The current in-app location (path + query), for use as a return destination. */
export function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/** `/login` (or `/register`) that returns to `returnTo` after a successful sign-in. */
export function loginUrl(returnTo?: string | null, opts: { reason?: "expired"; page?: "login" | "register" } = {}): string {
  const params = new URLSearchParams();
  if (opts.reason) params.set("reason", opts.reason);
  const safe = safeReturnTo(returnTo ?? null);
  if (safe && safe !== "/") params.set("returnTo", safe);
  const qs = params.toString();
  return `/${opts.page ?? "login"}${qs ? `?${qs}` : ""}`;
}

/** Session expired: sign in again, then come back to the page the user was on. */
export function redirectToLoginExpired(): void {
  window.location.assign(loginUrl(currentLocation(), { reason: "expired" }));
}
