import { NextRequest, NextResponse } from "next/server";
import { AppError } from "./errors";
import { logger, newRequestId, requestContext } from "./logger";
import { config } from "./config";
import { checkRateLimit, RateLimitRule } from "./security/rateLimiter";
import { getSessionFromRequest, SessionUser } from "./security/tokens";
import { AuthenticationError, AuthorizationError, RateLimitError, CsrfError } from "./errors";
import type { Permission } from "./rbac";
import { hasPermissionForUser } from "./rbac";
import { checkCsrf } from "./security/csrf";

/**
 * Best-effort client IP for rate-limit bucketing — SAFE ONLY when
 * `config.trustProxyHops` is set correctly for the actual deployment
 * topology (see config.ts). This is not optional nuance: naively trusting
 * X-Forwarded-For/X-Real-IP/CF-Connecting-IP from every caller lets an
 * attacker set an arbitrary value on each request and get a fresh
 * rate-limit bucket every time — a direct bypass of every IP-keyed limit
 * in this app (login brute-force, registration abuse, etc.).
 *
 *   - trustProxyHops === 0 (default): returns null, always. There is no
 *     trusted intermediary rewriting anything, so every header here is
 *     exactly as trustworthy as a value the caller typed in themselves —
 *     which is to say, not at all. Callers of clientIp() already handle
 *     null (see withRoute below): rate limiting still applies, just
 *     bucketed together rather than per-IP, and a warning is logged in
 *     production so a real misconfiguration doesn't go unnoticed.
 *   - trustProxyHops === N > 0: the real client is the entry N positions
 *     from the END of the X-Forwarded-For chain — NOT the first entry.
 *     "client, proxy1, proxy2" behind exactly 2 trusted proxies means
 *     "client" (index 0) is what's trustworthy; behind exactly 1, it's
 *     "proxy1" (the first hop's own rewrite). Taking the first entry
 *     unconditionally (the previous implementation) is exactly the bug:
 *     the first entry is always the original, client-supplied value,
 *     which is spoofable regardless of how many real proxies sit in
 *     front of the app.
 *   - X-Real-IP / CF-Connecting-IP are single values, not chains — safe
 *     to trust whenever trustProxyHops > 0 (the operator has attested a
 *     real proxy sits in front that sets/overwrites these).
 */
export function clientIp(req: NextRequest): string | null {
  if (config.trustProxyHops <= 0) return null;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const chain = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (chain.length > 0) {
      const index = Math.max(0, chain.length - config.trustProxyHops);
      const candidate = chain[index];
      if (candidate) return candidate;
    }
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  return null;
}

/** Standard security headers applied to every API response. Exported so routes that construct a response outside the json() helper (e.g. the PWA manifest, which needs a non-application/json Content-Type) can still apply the same headers rather than duplicating this list. */
export function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY"); // clickjacking
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  // This is an API-only service (JSON responses, no HTML rendering of user
  // content), so a strict CSP that disallows everything is appropriate.
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
  if (config.isProduction) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  // CORS: only the known frontend origin may call this API with credentials.
  res.headers.set("Access-Control-Allow-Origin", config.frontendOrigin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Vary", "Origin");
  return res;
}

export function json(body: unknown, init?: { status?: number; headers?: Record<string, string>; cache?: string }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  if (init?.cache) res.headers.set("Cache-Control", init.cache);
  if (init?.headers) for (const [k, v] of Object.entries(init.headers)) res.headers.set(k, v);
  return applySecurityHeaders(res);
}

function errorToResponse(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    const res = json(
      {
        error: err.category,
        message: err.message,
        fields: err.fields,
        requestId,
      },
      { status: err.httpStatus }
    );
    if (err instanceof RateLimitError && err.retryAfterSeconds != null) {
      res.headers.set("Retry-After", String(err.retryAfterSeconds));
    }
    return res;
  }
  // Unexpected error: log full detail server-side, expose nothing to the client.
  logger.error("Unhandled error", {
    requestId,
    errorCategory: "INTERNAL_ERROR",
    environment: config.nodeEnv,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return json(
    { error: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", requestId },
    { status: 500 }
  );
}

export type RouteContext = {
  requestId: string;
  req: NextRequest;
  /** Populated only if `auth: "required"` or `"optional"` and a valid session exists. */
  user: SessionUser | null;
  params: Record<string, string>;
};

type RouteOptions = {
  /** Per-route rate limiting rule (in addition to any global limiting). */
  rateLimit?: RateLimitRule;
  /** "required" -> 401 if no valid session. "optional" -> user may be null. "none" -> skip auth entirely. */
  auth?: "required" | "optional" | "none";
  /** If set, the authenticated user must have this permission (implies auth: "required"). */
  permission?: Permission;
};

/**
 * Wraps a route handler with: request-id assignment, structured logging,
 * rate limiting, authentication/authorization, and centralized error
 * handling. Every route in this project should be defined via `withRoute`
 * rather than exporting a bare handler, so these controls can never be
 * accidentally skipped.
 */
export function withRoute(
  options: RouteOptions,
  handler: (ctx: RouteContext) => Promise<NextResponse>
) {
  return async (req: NextRequest, routeArgs: { params: Record<string, string> } | undefined) => {
    const requestId = req.headers.get("x-request-id") ?? newRequestId();
    const start = Date.now();
    const params = routeArgs?.params ?? {};

    // Everything below runs inside this AsyncLocalStorage context, so every
    // logger.*() call anywhere in the call chain (a service, a repo, a
    // storage provider) automatically gets this same requestId attached —
    // see logger.ts's write(). No call site needs to pass it manually.
    return requestContext.run({ requestId }, async () => {
    // Hoisted above the try block (not declared inside it) specifically
    // so a FAILED request can still log which user was involved — see
    // the catch block below. Error monitoring needs this: "unhandled
    // error, don't know who" is a much harder incident to triage than
    // "unhandled error, user X, here's their id."
    let user: SessionUser | null = null;
    try {
      if (options.rateLimit) {
        const ip = clientIp(req);
        if (ip) {
          const result = await checkRateLimit(`${options.rateLimit.key}:${ip}`, options.rateLimit);
          if (!result.allowed) throw new RateLimitError(undefined, result.retryAfterSeconds);
        } else if (config.isProduction) {
          // No reverse proxy / CDN is forwarding a client IP header. We
          // still enforce the limit rather than let it through unbounded,
          // but every caller without an IP header shares one bucket — a
          // real misconfiguration, not a per-user problem. Surface it
          // loudly so it gets fixed instead of silently degrading.
          logger.warn("rate_limit.no_client_ip", {
            path: req.nextUrl.pathname,
            hint: "Reverse proxy/CDN is not forwarding X-Forwarded-For, X-Real-IP, or CF-Connecting-IP — all callers are sharing one rate-limit bucket.",
          });
          const result = await checkRateLimit(`${options.rateLimit.key}:unknown`, options.rateLimit);
          if (!result.allowed) throw new RateLimitError(undefined, result.retryAfterSeconds);
        }
        // In local development there is typically no reverse proxy in
        // front of `next dev`, so there is no real client IP to key on at
        // all. Rather than bucket every browser tab/every developer
        // testing locally under one shared "unknown" counter (which
        // trips the login limiter for everyone after a handful of
        // attempts total, not per-person), rate limiting is skipped in
        // dev when no IP is available. Production behavior above is
        // unaffected — it still enforces (and warns).
      }

      const authMode = options.auth ?? "required";

      // CSRF: only unsafe methods (state-changing) are checked at all —
      // GET/HEAD/OPTIONS never carry it, so safe methods always work
      // regardless of Origin/token. auth:"none" routes (login/register/
      // refresh) get Origin validation only, not the token check — see
      // security/csrf.ts's module header for why that split is safe.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const csrfResult = checkCsrf(req, authMode !== "none");
        if (!csrfResult.ok) {
          logger.warn("csrf.rejected", { path: req.nextUrl.pathname, method: req.method, reason: csrfResult.reason });
          throw new CsrfError();
        }
      }
      if (authMode !== "none") {
        user = await getSessionFromRequest(req);
        if (authMode === "required" && !user) throw new AuthenticationError("Sign in required.");
      }

      if (options.permission) {
        if (!user) throw new AuthenticationError("Sign in required.");
        if (!await hasPermissionForUser(user.id, user.role, options.permission)) {
          throw new AuthorizationError();
        }
      }

      const res = await handler({ requestId, req, user, params });
      res.headers.set("X-Request-Id", requestId);
      logger.info("request completed", {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        status: res.status,
        durationMs: Date.now() - start,
        userId: user?.id,
      });
      return applySecurityHeaders(res);
    } catch (err) {
      const res = errorToResponse(err, requestId);
      logger.warn("request failed", {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        status: res.status,
        errorCategory: err instanceof AppError ? err.category : "INTERNAL_ERROR",
        durationMs: Date.now() - start,
        userId: user?.id,
        environment: config.nodeEnv,
      });
      return res;
    }
    });
  };
}
