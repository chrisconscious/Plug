/**
 * CSRF protection — double-submit cookie + Origin validation.
 *
 * Why not rely on SameSite=Lax alone (see tokens.ts): it's real, useful
 * defense-in-depth, but it's a browser-behavior guarantee, not a
 * cryptographic one — older browsers, some in-app webviews, and certain
 * proxy/embedding configurations don't enforce it correctly, and Lax
 * specifically still allows cross-site GET-via-top-level-navigation. This
 * module adds two independent, verifiable checks for every state-changing
 * (non-GET/HEAD/OPTIONS) request:
 *
 *   1. Origin validation: the browser sets the `Origin` header on
 *      cross-origin AND same-origin fetch/XHR requests for unsafe methods,
 *      and JavaScript on an attacker's page cannot forge or suppress it.
 *      If it doesn't match this app's known frontend origin, reject.
 *
 *   2. Double-submit CSRF token: a random token is set as a *readable*
 *      (non-httpOnly) cookie on every response (see middleware.ts). The
 *      frontend's fetch wrapper reads that cookie and echoes it back as
 *      the `X-CSRF-Token` header on every mutating request (see
 *      web/src/lib/api.ts). An attacker's page can trigger a cross-site
 *      request that automatically carries cookies, but it CANNOT read
 *      this app's cookie value (Same-Origin Policy) to put it in a
 *      custom header — so a mismatched/missing header proves the request
 *      didn't originate from JavaScript that had same-origin access.
 *
 * Both checks are applied together (see http.ts's withRoute) — either one
 * failing rejects the request. Safe methods (GET/HEAD/OPTIONS) are never
 * checked; login/register/refresh (auth: "none" routes, no session cookie
 * to protect yet) get Origin validation only, not the token check — see
 * http.ts for why that split is safe.
 */
import type { NextRequest } from "next/server";
import { config } from "../config";

export const CSRF_COOKIE = "vv_csrf";
export const CSRF_HEADER = "x-csrf-token";

/**
 * Generates a CSRF token using the Web Crypto API (crypto.getRandomValues),
 * which works in BOTH the Next.js Edge runtime (middleware) and the Node.js
 * runtime (route handlers) — Node's `crypto.randomBytes` is not available in
 * the Edge runtime, and this module is used by src/middleware.ts.
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cookie options for the CSRF token — deliberately NOT httpOnly (the frontend must be able to read it to echo it back). */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: config.cookies.secure,
    sameSite: "lax" as const,
    path: "/",
    domain: config.cookies.domain === "localhost" ? undefined : config.cookies.domain,
    maxAge: 60 * 60 * 24 * 7, // 7 days — regenerated/refreshed on every response anyway (see middleware.ts)
  };
}

function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison — never use `===` for secret comparison (timing
  // side-channel). Deliberately implemented over UTF-8 code units rather than
  // Node's Buffer/timingSafeEqual so this module ALSO runs in the Next.js
  // Edge runtime (middleware), which has no Node crypto — this module is
  // imported by src/middleware.ts. Tokens are base64url ASCII, so iterating
  // code units is byte-equivalent.
  const lenA = a.length;
  const lenB = b.length;
  if (lenA !== lenB) return false;
  let diff = 0;
  for (let i = 0; i < lenA; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** True if the request's Origin header matches this app's known frontend origin. A missing Origin header is treated as failing — deliberately no fallback to Referer or "assume same-origin": a raw HTTP client that omits Origin is indistinguishable from a forged request without it, so failing closed is the only safe default. */
function originMatches(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return origin === config.frontendOrigin;
}

export type CsrfCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * The check applied by withRoute for unsafe methods. `requireToken` is
 * false for auth:"none" routes (login/register/refresh — see module
 * header for why), true otherwise.
 */
export function checkCsrf(req: NextRequest, requireToken: boolean): CsrfCheckResult {
  if (!originMatches(req)) {
    return { ok: false, reason: "Request origin did not match the expected frontend origin." };
  }
  if (!requireToken) return { ok: true };

  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return { ok: false, reason: "Missing or invalid CSRF token." };
  }
  return { ok: true };
}
