import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { withRoute, json } from "./http";

const FRONTEND_ORIGIN = "http://localhost:5173"; // matches config.ts's dev default
const API_BASE = "http://localhost:3001";

function makeRequest(opts: {
  method: string;
  origin?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  path?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.csrfHeader) headers.set("x-csrf-token", opts.csrfHeader);
  const cookieParts: string[] = [];
  if (opts.csrfCookie) cookieParts.push(`vv_csrf=${opts.csrfCookie}`);
  if (cookieParts.length) headers.set("cookie", cookieParts.join("; "));
  return new NextRequest(`${API_BASE}${opts.path ?? "/api/v1/test-route"}`, { method: opts.method, headers });
}

describe("withRoute — CSRF protection end-to-end (real request pipeline, not a reimplementation)", () => {
  // A representative authenticated, state-changing route — the shape of
  // nearly every mutating endpoint in this app (cart, orders, profile,
  // admin actions, uploads, etc. all go through the exact same withRoute).
  const protectedRoute = withRoute({ auth: "required" }, async () => json({ ok: true }));

  it("rejects a forged cross-site POST (wrong Origin) before it ever reaches auth or the handler", async () => {
    const req = makeRequest({ method: "POST", origin: "https://evil.example.com" });
    const res = await protectedRoute(req, undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("CSRF_ERROR");
  });

  it("rejects a same-origin-looking POST with no CSRF token at all (e.g. a raw curl/script, not the real frontend)", async () => {
    const req = makeRequest({ method: "POST", origin: FRONTEND_ORIGIN });
    const res = await protectedRoute(req, undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("CSRF_ERROR");
  });

  it("rejects a mismatched cookie/header pair (an attacker who can guess/set A cookie but not read the real one)", async () => {
    const req = makeRequest({ method: "POST", origin: FRONTEND_ORIGIN, csrfCookie: "real-token", csrfHeader: "attacker-guess" });
    const res = await protectedRoute(req, undefined);
    expect(res.status).toBe(403);
  });

  it("passes CSRF (proceeds to the NEXT check, auth, which correctly 401s with no session) when Origin and token both match", async () => {
    const req = makeRequest({ method: "POST", origin: FRONTEND_ORIGIN, csrfCookie: "matching-token", csrfHeader: "matching-token" });
    const res = await protectedRoute(req, undefined);
    // 401, not 403 — proves the request cleared CSRF and failed at the
    // NEXT layer (no session cookie was sent), not at CSRF.
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("AUTHENTICATION_ERROR");
  });

  it("never checks CSRF for safe methods (GET) — a cross-site GET still isn't blocked by CSRF, only by whatever the route itself requires", async () => {
    const req = makeRequest({ method: "GET", origin: "https://evil.example.com" });
    const res = await protectedRoute(req, undefined);
    // Still 401 (no session) — NOT 403 — proving Origin/CSRF was never
    // even evaluated for a GET.
    expect(res.status).toBe(401);
  });
});

describe("withRoute — CSRF for auth:\"none\" routes (login/register/refresh-style)", () => {
  const publicMutatingRoute = withRoute({ auth: "none" }, async () => json({ ok: true }));

  it("still rejects a forged cross-site request via Origin validation", async () => {
    const req = makeRequest({ method: "POST", origin: "https://evil.example.com" });
    const res = await publicMutatingRoute(req, undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("CSRF_ERROR");
  });

  it("succeeds with a valid Origin and NO CSRF token — auth:none routes don't require the token (no session exists yet to protect)", async () => {
    const req = makeRequest({ method: "POST", origin: FRONTEND_ORIGIN });
    const res = await publicMutatingRoute(req, undefined);
    expect(res.status).toBe(200);
  });
});
