import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/repos/users.repo", () => ({ findUserById: vi.fn() }));

import * as usersRepo from "@/lib/db/repos/users.repo";
import { createAccessToken } from "@/lib/security/tokens";
import { withRoute, json } from "@/lib/http";
import { NotFoundError } from "@/lib/errors";

const FRONTEND_ORIGIN = "http://localhost:5173";
const API_BASE = "http://localhost:3001";

function fakeDbUser(overrides: Partial<Awaited<ReturnType<typeof usersRepo.findUserById>>> = {}) {
  return {
    id: "user-1", email: "user@example.com", fullName: null, passwordHash: "hash", role: "CUSTOMER" as const,
    disabled: false, emailVerified: true, totpSecret: null, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("withRoute — error-monitoring context on a failed request", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(usersRepo.findUserById).mockReset();
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("includes the authenticated user's id in the failure log — this is the actual fix: `user` used to be scoped inside the try block, invisible to the catch block's logging", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeDbUser());
    const token = createAccessToken({ id: "user-1", email: "user@example.com", role: "CUSTOMER" });
    const route = withRoute({ auth: "required" }, async () => {
      throw new NotFoundError("Something specific was not found.");
    });
    const req = new NextRequest(`${API_BASE}/api/v1/test`, {
      method: "GET",
      headers: { origin: FRONTEND_ORIGIN, cookie: `vv_access=${token}` },
    });

    await route(req, undefined);

    const loggedLines = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const failureLog = loggedLines.find((l) => l.message === "request failed");
    expect(failureLog?.userId).toBe("user-1");
    expect(failureLog?.errorCategory).toBe("NOT_FOUND");
  });

  it("logs errorCategory: INTERNAL_ERROR (and no userId) for a genuinely unauthenticated request that throws unexpectedly", async () => {
    const route = withRoute({ auth: "none" }, async () => {
      throw new Error("something truly unexpected");
    });
    const req = new NextRequest(`${API_BASE}/api/v1/test`, { method: "GET", headers: { origin: FRONTEND_ORIGIN } });

    await route(req, undefined);

    const loggedLines = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const failureLog = loggedLines.find((l) => l.message === "request failed");
    expect(failureLog?.errorCategory).toBe("INTERNAL_ERROR");
    expect(failureLog?.userId).toBeUndefined();
  });

  it("includes the environment in every failure log", async () => {
    const route = withRoute({ auth: "none" }, async () => json({ ok: true }));
    // Force a failure via CSRF rejection (a POST with no valid Origin) —
    // any failure path exercises the same logging call.
    const req = new NextRequest(`${API_BASE}/api/v1/test`, { method: "POST", headers: { origin: "https://evil.example.com" } });

    await route(req, undefined);

    const loggedLines = warnSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const failureLog = loggedLines.find((l) => l.message === "request failed");
    expect(failureLog?.environment).toBeDefined();
  });
});
