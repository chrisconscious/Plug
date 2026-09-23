import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/repos/users.repo", () => ({ findUserById: vi.fn() }));

import * as usersRepo from "@/lib/db/repos/users.repo";
import { createAccessToken } from "@/lib/security/tokens";
import { withRoute, json } from "@/lib/http";

const FRONTEND_ORIGIN = "http://localhost:5173";
const API_BASE = "http://localhost:3001";
const CSRF = "test-csrf-token";

function fakeDbUser(overrides: Partial<Awaited<ReturnType<typeof usersRepo.findUserById>>> = {}) {
  return {
    id: "u1", email: "user@example.com", fullName: null, passwordHash: "hash", role: "CUSTOMER" as const,
    disabled: false, emailVerified: true, totpSecret: null, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function requestWithSession(opts: { method?: string; accessToken?: string }): NextRequest {
  const headers = new Headers();
  headers.set("origin", FRONTEND_ORIGIN);
  const cookieParts: string[] = [];
  if (opts.accessToken) cookieParts.push(`vv_access=${opts.accessToken}`);
  const method = opts.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-csrf-token", CSRF);
    cookieParts.push(`vv_csrf=${CSRF}`);
  }
  if (cookieParts.length) headers.set("cookie", cookieParts.join("; "));
  return new NextRequest(`${API_BASE}/api/v1/test-admin-route`, { method, headers });
}

beforeEach(() => {
  vi.mocked(usersRepo.findUserById).mockReset();
});

describe("protected endpoint (auth: required)", () => {
  const route = withRoute({ auth: "required" }, async ({ user }) => json({ userId: user!.id }));

  it("rejects with 401 when no session cookie is present", async () => {
    const res = await route(requestWithSession({}), undefined);
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when the access token is garbage (not a validly signed token)", async () => {
    const res = await route(requestWithSession({ accessToken: "not-a-real-token" }), undefined);
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when the token is validly signed but the user no longer exists (e.g. deleted)", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(null);
    const token = createAccessToken({ id: "deleted-user", email: "gone@example.com", role: "CUSTOMER" });
    const res = await route(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when the token is valid but the account is disabled", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser({ disabled: true }));
    const token = createAccessToken({ id: "u1", email: "user@example.com", role: "CUSTOMER" });
    const res = await route(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(401);
  });

  it("succeeds with a validly signed token for an active user", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser());
    const token = createAccessToken({ id: "u1", email: "user@example.com", role: "CUSTOMER" });
    const res = await route(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("u1");
  });
});

describe("admin endpoint (permission-gated RBAC)", () => {
  // A representative admin-only action — the same shape as every real
  // admin route (e.g. brand/category management uses "products.create" or
  // similar; this test uses "system.manage" specifically because it's
  // SUPER_ADMIN-only, giving a clean 3-way check: no session / wrong role
  // / right role).
  const adminRoute = withRoute({ permission: "system.manage" }, async ({ user }) => json({ ok: true, actorRole: user!.role }));

  it("rejects with 401 when there is no session at all", async () => {
    const res = await adminRoute(requestWithSession({}), undefined);
    expect(res.status).toBe(401);
  });

  it("rejects a regular CUSTOMER with 403 (authenticated, but not authorized)", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser({ role: "CUSTOMER" }));
    const token = createAccessToken({ id: "u1", email: "customer@example.com", role: "CUSTOMER" });
    const res = await adminRoute(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("AUTHORIZATION_ERROR");
  });

  it("rejects a regular ADMIN with 403 for a SUPER_ADMIN-only permission", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser({ id: "u2", role: "ADMIN" }));
    const token = createAccessToken({ id: "u2", email: "admin@example.com", role: "ADMIN" });
    const res = await adminRoute(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(403);
  });

  it("succeeds for a SUPER_ADMIN", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser({ id: "u3", role: "SUPER_ADMIN" }));
    const token = createAccessToken({ id: "u3", email: "super@example.com", role: "SUPER_ADMIN" });
    const res = await adminRoute(requestWithSession({ accessToken: token }), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actorRole).toBe("SUPER_ADMIN");
  });

  it("a state-changing admin action still enforces CSRF on top of RBAC", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser({ id: "u3", role: "SUPER_ADMIN" }));
    const token = createAccessToken({ id: "u3", email: "super@example.com", role: "SUPER_ADMIN" });
    const req = new NextRequest(`${API_BASE}/api/v1/test-admin-route`, {
      method: "POST",
      headers: { origin: FRONTEND_ORIGIN, cookie: `vv_access=${token}` }, // no CSRF token attached
    });
    const postAdminRoute = withRoute({ permission: "system.manage" }, async () => json({ ok: true }));
    const res = await postAdminRoute(req, undefined);
    expect(res.status).toBe(403); // CSRF, not RBAC — proves both layers are independently enforced
  });
});
