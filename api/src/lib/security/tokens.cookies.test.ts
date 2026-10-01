import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";

// Production-shaped cookie settings: a real COOKIE_DOMAIN and Secure cookies.
vi.mock("../config", () => ({
  config: {
    cookies: { domain: "plugwear.trade", secure: true },
    auth: { accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 1209600, accessTokenSecret: "a".repeat(64), refreshTokenSecret: "b".repeat(64) },
  },
}));
vi.mock("../db/repos/sessions.repo", () => ({}));
vi.mock("../db/repos/users.repo", () => ({}));

import { setAuthCookies, clearAuthCookies } from "./tokens";

/** name -> lowercased Set-Cookie attributes, from a response's headers. */
function cookies(res: NextResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) out[line.split("=")[0]!] = line.toLowerCase();
  return out;
}

describe("auth cookies with a production COOKIE_DOMAIN", () => {
  it("clears each cookie with the same Domain and Path it was set with (otherwise the browser keeps it)", () => {
    const set = new NextResponse(null);
    setAuthCookies(set, "access", "refresh");
    const cleared = new NextResponse(null);
    clearAuthCookies(cleared);

    const s = cookies(set);
    const c = cookies(cleared);
    for (const name of ["vv_access", "vv_refresh", "vv_session"]) {
      expect(s[name]).toContain("domain=plugwear.trade");
      expect(c[name]).toContain("domain=plugwear.trade");
      expect(c[name]).toMatch(/max-age=0|expires=thu, 01 jan 1970/);
      expect(c[name]!.match(/path=[^;]+/)?.[0]).toBe(s[name]!.match(/path=[^;]+/)?.[0]);
    }
    expect(c.vv_refresh).toContain("path=/api/v1/auth");
  });
});
