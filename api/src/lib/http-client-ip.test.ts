import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// A mutable mock config object — tests change .trustProxyHops between
// cases to simulate different deployment topologies without needing to
// reload the module (config.ts is otherwise a real, frozen singleton).
const mockConfig = vi.hoisted(() => ({ trustProxyHops: 0, frontendOrigin: "http://localhost:5173" }));
vi.mock("./config", () => ({ config: mockConfig }));

import { clientIp } from "./http";

function fakeRequest(headers: Record<string, string>): NextRequest {
  return { headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } } as unknown as NextRequest;
}

beforeEach(() => {
  mockConfig.trustProxyHops = 0;
});

describe("clientIp — trustProxyHops = 0 (the safe default)", () => {
  it("ignores X-Forwarded-For entirely, even when present", () => {
    const req = fakeRequest({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(req)).toBeNull();
  });

  it("ignores an attacker directly spoofing X-Forwarded-For with a fake chain", () => {
    // This is exactly the attack this default prevents: with no trusted
    // proxy in front, an attacker can put ANYTHING here.
    const req = fakeRequest({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 127.0.0.1" });
    expect(clientIp(req)).toBeNull();
  });

  it("ignores X-Real-IP and CF-Connecting-IP too", () => {
    expect(clientIp(fakeRequest({ "x-real-ip": "1.2.3.4" }))).toBeNull();
    expect(clientIp(fakeRequest({ "cf-connecting-ip": "1.2.3.4" }))).toBeNull();
  });
});

describe("clientIp — trustProxyHops = 1 (one real proxy in front)", () => {
  beforeEach(() => { mockConfig.trustProxyHops = 1; });

  it("takes the last entry in a 1-entry chain — the genuine client behind one hop", () => {
    const req = fakeRequest({ "x-forwarded-for": "203.0.113.7" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("does NOT take the first entry when an attacker prepends fake entries — takes the last (trusted) one instead", () => {
    // The proxy appends the real connecting IP as the LAST entry; anything
    // before it (including this) is whatever the client itself sent.
    const req = fakeRequest({ "x-forwarded-for": "9.9.9.9-attacker-supplied, 203.0.113.7" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const req = fakeRequest({ "x-real-ip": "203.0.113.7" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to CF-Connecting-IP when the others are absent (legitimate Cloudflare traffic)", () => {
    const req = fakeRequest({ "cf-connecting-ip": "203.0.113.7" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });
});

describe("clientIp — trustProxyHops = 2 (e.g. Cloudflare -> load balancer -> app)", () => {
  beforeEach(() => { mockConfig.trustProxyHops = 2; });

  it("takes the entry 2 positions from the end — the client, not either proxy", () => {
    // Chain as it would actually arrive: "client, hop1's-view-of-client"
    // Each proxy appends what it saw as the connecting IP; with 2 trusted
    // hops the real client is 2 from the end.
    const req = fakeRequest({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("still resists a spoofed extra entry prepended by the attacker", () => {
    const req = fakeRequest({ "x-forwarded-for": "9.9.9.9-attacker-supplied, 203.0.113.7, 10.0.0.1" });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("degrades gracefully (does not throw) if the chain is shorter than configured hops — a real misconfiguration case", () => {
    const req = fakeRequest({ "x-forwarded-for": "203.0.113.7" });
    expect(() => clientIp(req)).not.toThrow();
    expect(clientIp(req)).toBe("203.0.113.7"); // clamped to the earliest available entry, not a crash
  });
});

describe("clientIp — no proxy headers present at all", () => {
  it("returns null regardless of trustProxyHops setting", () => {
    mockConfig.trustProxyHops = 2;
    expect(clientIp(fakeRequest({}))).toBeNull();
  });
});
