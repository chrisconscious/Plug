import { describe, it, expect } from "vitest";
import { checkCsrf, generateCsrfToken, CSRF_COOKIE, CSRF_HEADER } from "./csrf";

// A minimal fake satisfying only what checkCsrf actually reads from
// NextRequest — no need to construct a real one for a pure-logic test.
function fakeRequest(opts: { origin?: string; cookieToken?: string; headerToken?: string }) {
  return {
    headers: {
      get: (name: string) => {
        if (name === "origin") return opts.origin ?? null;
        if (name === CSRF_HEADER) return opts.headerToken ?? null;
        return null;
      },
    },
    cookies: {
      get: (name: string) => (name === CSRF_COOKIE && opts.cookieToken ? { value: opts.cookieToken } : undefined),
    },
  } as unknown as Parameters<typeof checkCsrf>[0];
}

const FRONTEND_ORIGIN = "http://localhost:5173"; // matches config.ts's dev default

describe("checkCsrf — Origin validation", () => {
  it("rejects a request with no Origin header", () => {
    const result = checkCsrf(fakeRequest({}), false);
    expect(result.ok).toBe(false);
  });

  it("rejects a request with a mismatched Origin", () => {
    const result = checkCsrf(fakeRequest({ origin: "https://evil.example.com" }), false);
    expect(result.ok).toBe(false);
  });

  it("accepts a request with the correct Origin when no token is required", () => {
    const result = checkCsrf(fakeRequest({ origin: FRONTEND_ORIGIN }), false);
    expect(result.ok).toBe(true);
  });
});

describe("checkCsrf — double-submit token (requireToken: true)", () => {
  it("rejects when the CSRF cookie is missing entirely", () => {
    const result = checkCsrf(fakeRequest({ origin: FRONTEND_ORIGIN, headerToken: "some-token" }), true);
    expect(result.ok).toBe(false);
  });

  it("rejects when the header is missing entirely", () => {
    const result = checkCsrf(fakeRequest({ origin: FRONTEND_ORIGIN, cookieToken: "some-token" }), true);
    expect(result.ok).toBe(false);
  });

  it("rejects when the cookie and header values don't match (e.g. an attacker's own token in the header)", () => {
    const result = checkCsrf(
      fakeRequest({ origin: FRONTEND_ORIGIN, cookieToken: "real-token-value", headerToken: "attacker-guessed-value" }),
      true
    );
    expect(result.ok).toBe(false);
  });

  it("accepts when Origin is correct AND cookie/header tokens match", () => {
    const token = generateCsrfToken();
    const result = checkCsrf(fakeRequest({ origin: FRONTEND_ORIGIN, cookieToken: token, headerToken: token }), true);
    expect(result.ok).toBe(true);
  });

  it("still rejects a matching token pair if Origin is wrong — both checks must pass, not either", () => {
    const token = generateCsrfToken();
    const result = checkCsrf(
      fakeRequest({ origin: "https://evil.example.com", cookieToken: token, headerToken: token }),
      true
    );
    expect(result.ok).toBe(false);
  });
});

describe("generateCsrfToken", () => {
  it("produces a non-empty, URL-safe string", () => {
    const token = generateCsrfToken();
    expect(token.length).toBeGreaterThan(20);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a different token on every call", () => {
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});
