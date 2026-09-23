import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { captureError } from "./errorMonitoring";

const FRONTEND_ORIGIN = "http://localhost:5173";
const API_BASE = "http://localhost:3001";

describe("captureError — never captures known-sensitive fields", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("strips password/token/cookie/secret fields from the context before logging, even if a caller passes them", () => {
    captureError({
      category: "authentication_failure",
      message: "login failed",
      context: {
        password: "should-never-appear",
        accessToken: "should-never-appear-either",
        refreshToken: "nor-this",
        cookie: "nor-this-either",
        secret: "definitely-not-this",
        cardNumber: "not-this",
        resetToken: "not-this-either",
        // A genuinely safe field that SHOULD survive:
        attemptCount: 3,
      },
    });

    const logged = errorSpy.mock.calls.map((call) => call[0] as string).join("\n");
    expect(logged).not.toContain("should-never-appear");
    expect(logged).not.toContain("nor-this");
    expect(logged).not.toContain("definitely-not-this");
    expect(logged).not.toContain("not-this-either");
    expect(logged).toContain("attemptCount");
  });

  it("includes the category, requestId, and endpoint for real diagnosability", () => {
    captureError({
      category: "database_failure",
      message: "connection pool exhausted",
      requestId: "req-abc-123",
      endpoint: "POST /api/v1/orders",
    });

    const logged = errorSpy.mock.calls.map((call) => call[0] as string).join("\n");
    expect(logged).toContain("req-abc-123");
    expect(logged).toContain("database_failure");
    expect(logged).toContain("POST /api/v1/orders");
  });
});

describe("POST /api/v1/client-errors — end to end", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("accepts a report from an unauthenticated visitor (auth: optional — a crash can happen whether or not someone is logged in)", async () => {
    const { POST } = await import("../app/api/v1/client-errors/route");
    const req = new NextRequest(`${API_BASE}/api/v1/client-errors`, {
      method: "POST",
      headers: { origin: FRONTEND_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ message: "TypeError: cannot read property of undefined", url: "https://example.com/shop" }),
    });

    const res = await POST(req, undefined);
    expect(res.status).toBe(200);

    const logged = errorSpy.mock.calls.map((call) => call[0] as string).join("\n");
    expect(logged).toContain("frontend_exception");
    expect(logged).toContain("cannot read property of undefined");
  });

  it("rejects a report with no message (validation, not a silent no-op)", async () => {
    const { POST } = await import("../app/api/v1/client-errors/route");
    const req = new NextRequest(`${API_BASE}/api/v1/client-errors`, {
      method: "POST",
      headers: { origin: FRONTEND_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req, undefined);
    expect(res.status).toBe(400);
  });
});
