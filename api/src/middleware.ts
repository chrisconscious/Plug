import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config as appConfig } from "./lib/config";
import { CSRF_COOKIE, generateCsrfToken, csrfCookieOptions } from "./lib/security/csrf";

/**
 * Two concerns handled here, both because they need to run before any
 * route handler (or, for OPTIONS, instead of one):
 *
 * 1. CORS preflight (OPTIONS). Actual GET/POST/PATCH/DELETE responses
 *    already get their CORS headers from src/lib/http.ts
 *    (applySecurityHeaders). But a browser sends an OPTIONS preflight
 *    before the real request whenever it's cross-origin AND credentialed
 *    with a non-simple content-type (application/json) or a custom header
 *    (X-CSRF-Token) — exactly how the Vite frontend calls this API. A
 *    preflight has no route handler behind it, so it must be answered
 *    here or the browser blocks the follow-up request.
 *
 * 2. Ensuring a CSRF cookie exists. The double-submit CSRF check (see
 *    security/csrf.ts, applied in http.ts's withRoute) needs the frontend
 *    to already have a readable `vv_csrf` cookie before it can echo it
 *    back as a header — including on the very first authenticated
 *    mutation a brand-new visitor makes, which might come right after
 *    their first-ever GET. Setting it here, unconditionally, on every
 *    non-OPTIONS response (only if not already present) means it's always
 *    there in time, without every route handler needing to think about it.
 */
export function middleware(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": appConfig.frontendOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-CSRF-Token, X-Request-Id",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }

  const res = NextResponse.next();
  if (!req.cookies.get(CSRF_COOKIE)) {
    res.cookies.set(CSRF_COOKIE, generateCsrfToken(), csrfCookieOptions());
  }
  return res;
}

// Only run for API routes — the preflight concern does not apply elsewhere.
export const config = {
  matcher: ["/api/:path*"],
};
