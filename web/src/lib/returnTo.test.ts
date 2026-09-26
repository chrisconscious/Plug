import { describe, it, expect } from "vitest";
import { safeReturnTo, loginUrl } from "./returnTo";

describe("safeReturnTo", () => {
  it("accepts internal paths with their query (checkout state lives there)", () => {
    expect(safeReturnTo("/checkout")).toBe("/checkout");
    expect(safeReturnTo("/checkout?buyNow=abc-123&qty=2")).toBe("/checkout?buyNow=abc-123&qty=2");
    expect(safeReturnTo("/product/tee?variant=v1&qty=1")).toBe("/product/tee?variant=v1&qty=1");
  });

  it.each([
    "https://evil.example/checkout",
    "//evil.example/x",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "checkout",
    "/check out",
    "/x\u0000y",
    "/%2F%2Fevil.example",
    "",
    null,
  ])("rejects unsafe or foreign destination %j", (v) => {
    const out = safeReturnTo(v as string | null);
    // either rejected, or normalised to a path on this site only
    if (out !== null) expect(out.startsWith("/") && !out.startsWith("//")).toBe(true);
    if (v === "/%2F%2Fevil.example") expect(out).toBe("/%2F%2Fevil.example");
    else expect(out).toBeNull();
  });

  it("never returns into the auth pages (no redirect loops)", () => {
    expect(safeReturnTo("/login?returnTo=/checkout")).toBeNull();
    expect(safeReturnTo("/register")).toBeNull();
    expect(safeReturnTo("/reset-password?token=x")).toBeNull();
  });
});

describe("loginUrl", () => {
  it("carries a safe destination and drops an unsafe one", () => {
    expect(loginUrl("/checkout?buyNow=v1&qty=1")).toBe("/login?returnTo=%2Fcheckout%3FbuyNow%3Dv1%26qty%3D1");
    expect(loginUrl("https://evil.example")).toBe("/login");
    expect(loginUrl("/", { reason: "expired" })).toBe("/login?reason=expired");
    expect(loginUrl("/cart", { page: "register" })).toBe("/register?returnTo=%2Fcart");
  });
});
