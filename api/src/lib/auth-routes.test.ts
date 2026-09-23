import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/auth.service", () => ({
  loginWithPassword: vi.fn(),
  rotateRefreshToken: vi.fn(),
  logout: vi.fn(),
  getPublicUser: vi.fn(),
}));

import * as authService from "@/lib/services/auth.service";
import { POST as loginHandler } from "@/app/api/v1/auth/login/route";
import { POST as refreshHandler } from "@/app/api/v1/auth/refresh/route";
import { POST as logoutHandler } from "@/app/api/v1/auth/logout/route";
import { GET as meHandler } from "@/app/api/v1/auth/me/route";

const FRONTEND_ORIGIN = "http://localhost:5173";
const API_BASE = "http://localhost:3001";
const CSRF = "test-csrf-token";

function makeRequest(opts: {
  method: string;
  path: string;
  body?: unknown;
  cookies?: Record<string, string>;
  includeCsrf?: boolean; // attaches a matching CSRF cookie+header, as the real frontend does
}): NextRequest {
  const headers = new Headers();
  headers.set("origin", FRONTEND_ORIGIN);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const cookieParts: string[] = [];
  if (opts.includeCsrf) {
    headers.set("x-csrf-token", CSRF);
    cookieParts.push(`vv_csrf=${CSRF}`);
  }
  for (const [k, v] of Object.entries(opts.cookies ?? {})) cookieParts.push(`${k}=${v}`);
  if (cookieParts.length) headers.set("cookie", cookieParts.join("; "));
  return new NextRequest(`${API_BASE}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  vi.mocked(authService.loginWithPassword).mockReset();
  vi.mocked(authService.rotateRefreshToken).mockReset();
  vi.mocked(authService.logout).mockReset();
  vi.mocked(authService.getPublicUser).mockReset();
});

describe("POST /auth/login", () => {
  it("succeeds with correct credentials and sets session cookies", async () => {
    vi.mocked(authService.loginWithPassword).mockResolvedValue({
      mfaRequired: false,
      user: { id: "u1", email: "test@example.com", fullName: null, role: "CUSTOMER", emailVerified: true, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z" },
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
    });
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/login", body: { email: "test@example.com", password: "correct-password" } });
    const res = await loginHandler(req, undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfaRequired).toBe(false);
    expect(body.user.email).toBe("test@example.com");
    expect(res.cookies.get("vv_access")?.value).toBe("fake-access-token");
    expect(res.cookies.get("vv_refresh")?.value).toBe("fake-refresh-token");
  });

  it("rejects invalid credentials with 401 and does not set session cookies", async () => {
    const { AuthenticationError } = await import("@/lib/errors");
    vi.mocked(authService.loginWithPassword).mockRejectedValue(new AuthenticationError("Invalid email or password."));
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/login", body: { email: "test@example.com", password: "wrong" } });
    const res = await loginHandler(req, undefined);
    expect(res.status).toBe(401);
    expect(res.cookies.get("vv_access")).toBeUndefined();
  });

  it("returns an MFA challenge (no session cookies yet) when the account has MFA enabled", async () => {
    vi.mocked(authService.loginWithPassword).mockResolvedValue({ mfaRequired: true, mfaToken: "pending-mfa-token" });
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/login", body: { email: "admin@example.com", password: "correct-password" } });
    const res = await loginHandler(req, undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaToken).toBe("pending-mfa-token");
    expect(res.cookies.get("vv_access")).toBeUndefined(); // not authenticated yet
  });

  it("rejects a cross-origin login attempt (Origin validation applies even to auth:none routes)", async () => {
    const req = new NextRequest(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { origin: "https://evil.example.com", "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "x" }),
    });
    const res = await loginHandler(req, undefined);
    expect(res.status).toBe(403);
    expect(authService.loginWithPassword).not.toHaveBeenCalled();
  });
});

describe("POST /auth/refresh", () => {
  it("rotates tokens and sets fresh cookies on a valid refresh session", async () => {
    vi.mocked(authService.rotateRefreshToken).mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/refresh", cookies: { vv_refresh: "valid-refresh-token" } });
    const res = await refreshHandler(req, undefined);
    expect(res.status).toBe(200);
    expect(res.cookies.get("vv_access")?.value).toBe("new-access");
  });

  it("rejects with 401 and clears cookies when there is no refresh cookie at all", async () => {
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/refresh" });
    const res = await refreshHandler(req, undefined);
    expect(res.status).toBe(401);
    expect(authService.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("rejects an EXPIRED refresh session with 401 and clears cookies", async () => {
    const { AuthenticationError } = await import("@/lib/errors");
    vi.mocked(authService.rotateRefreshToken).mockRejectedValue(new AuthenticationError("Session expired."));
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/refresh", cookies: { vv_refresh: "expired-token" } });
    const res = await refreshHandler(req, undefined);
    expect(res.status).toBe(401);
    expect(res.cookies.get("vv_access")?.value).toBe(""); // cleared, not left stale
  });

  it("rejects an INVALID (malformed/tampered) refresh token with 401 and clears cookies", async () => {
    const { AuthenticationError } = await import("@/lib/errors");
    vi.mocked(authService.rotateRefreshToken).mockRejectedValue(new AuthenticationError("Session expired."));
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/refresh", cookies: { vv_refresh: "not-a-real-token-at-all" } });
    const res = await refreshHandler(req, undefined);
    expect(res.status).toBe(401);
  });

  it("rejects a REVOKED session (e.g. after logout-everywhere or password reset) with 401 and clears cookies", async () => {
    const { AuthenticationError } = await import("@/lib/errors");
    vi.mocked(authService.rotateRefreshToken).mockRejectedValue(new AuthenticationError("Session expired."));
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/refresh", cookies: { vv_refresh: "revoked-session-token" } });
    const res = await refreshHandler(req, undefined);
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("clears session cookies and succeeds even with a valid session", async () => {
    vi.mocked(authService.logout).mockResolvedValue(undefined);
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/logout", cookies: { vv_refresh: "some-token" }, includeCsrf: true });
    const res = await logoutHandler(req, undefined);
    expect(res.status).toBe(200);
    expect(res.cookies.get("vv_access")?.value).toBe("");
  });

  it("succeeds even with no session at all (idempotent — auth: optional)", async () => {
    vi.mocked(authService.logout).mockResolvedValue(undefined);
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/logout", includeCsrf: true });
    const res = await logoutHandler(req, undefined);
    expect(res.status).toBe(200);
  });

  it("still requires CSRF compliance despite auth: optional (a cookie-bearing request is still a state-changing one)", async () => {
    const req = makeRequest({ method: "POST", path: "/api/v1/auth/logout" }); // no CSRF token attached
    const res = await logoutHandler(req, undefined);
    expect(res.status).toBe(403);
    expect(authService.logout).not.toHaveBeenCalled();
  });
});

describe("GET /auth/me (representative protected endpoint)", () => {
  it("rejects with 401 when there is no session cookie at all", async () => {
    const req = makeRequest({ method: "GET", path: "/api/v1/auth/me" });
    const res = await meHandler(req, undefined);
    expect(res.status).toBe(401);
    expect(authService.getPublicUser).not.toHaveBeenCalled(); // never reached the handler
  });

  it("is a GET — never blocked by CSRF regardless of Origin", async () => {
    const req = new NextRequest(`${API_BASE}/api/v1/auth/me`, { method: "GET", headers: { origin: "https://evil.example.com" } });
    const res = await meHandler(req, undefined);
    // 401 (no session), not 403 (CSRF) — proves GET was never CSRF-checked.
    expect(res.status).toBe(401);
  });
});
