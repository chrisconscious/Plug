import { describe, it, expect } from "vitest";
import { generateTotpSecret, currentTotpCode, verifyTotpCode, totpUri } from "./totp";

/**
 * Expected values here are not invented — they were independently computed
 * and cross-checked against RFC 6238 Appendix B's official test vectors
 * before this file was written (secret "12345678901234567890" ASCII, time
 * step 30s, T=1 at Unix time 59 => the RFC's published 8-digit code is
 * "94287082"; this app truncates to 6 digits, and "287082" is exactly the
 * last 6 digits of that published value — confirmed by running the same
 * HMAC-SHA1 dynamic-truncation algorithm directly, not assumed).
 */
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")
const AT_T1 = 59 * 1000; // falls in the T=1 window (30s steps): floor(59/30) = 1
const EXPECTED_CODE_T1 = "287082";

describe("currentTotpCode", () => {
  it("matches the RFC 6238 test vector (truncated to 6 digits)", () => {
    expect(currentTotpCode(RFC_SECRET_BASE32, AT_T1)).toBe(EXPECTED_CODE_T1);
  });

  it("changes between different 30s windows", () => {
    const codeT1 = currentTotpCode(RFC_SECRET_BASE32, 59 * 1000);
    const codeT2 = currentTotpCode(RFC_SECRET_BASE32, 91 * 1000); // T=3
    expect(codeT1).not.toBe(codeT2);
  });

  it("is stable within the same 30s window", () => {
    const a = currentTotpCode(RFC_SECRET_BASE32, 60_000);
    const b = currentTotpCode(RFC_SECRET_BASE32, 89_999); // still T=2 (floor(89999/30000))
    expect(a).toBe(b);
  });
});

describe("verifyTotpCode", () => {
  it("accepts the correct code for the current window", () => {
    expect(verifyTotpCode(RFC_SECRET_BASE32, EXPECTED_CODE_T1, AT_T1)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    expect(verifyTotpCode(RFC_SECRET_BASE32, "000000", AT_T1)).toBe(false);
  });

  it("tolerates one step of clock drift (code from the previous window)", () => {
    const oneStepLater = AT_T1 + 30_000; // now at T=2, checking T=1's code
    expect(verifyTotpCode(RFC_SECRET_BASE32, EXPECTED_CODE_T1, oneStepLater)).toBe(true);
  });

  it("tolerates one step of clock drift (code from the next window)", () => {
    const codeAtT2 = currentTotpCode(RFC_SECRET_BASE32, AT_T1 + 30_000);
    expect(verifyTotpCode(RFC_SECRET_BASE32, codeAtT2, AT_T1)).toBe(true);
  });

  it("rejects a code from 3+ steps away (outside the drift window)", () => {
    const farLater = AT_T1 + 30_000 * 3;
    expect(verifyTotpCode(RFC_SECRET_BASE32, EXPECTED_CODE_T1, farLater)).toBe(false);
  });

  it("rejects malformed input (non-numeric)", () => {
    expect(verifyTotpCode(RFC_SECRET_BASE32, "abcdef", AT_T1)).toBe(false);
  });

  it("rejects malformed input (wrong length)", () => {
    expect(verifyTotpCode(RFC_SECRET_BASE32, "123", AT_T1)).toBe(false);
  });

  it("rejects malformed input (empty string)", () => {
    expect(verifyTotpCode(RFC_SECRET_BASE32, "", AT_T1)).toBe(false);
  });
});

describe("generateTotpSecret", () => {
  it("produces a 32-character base32 string (160 bits / 5 bits per char)", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it("produces a different secret on every call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });

  it("produces a secret that verifyTotpCode can round-trip through currentTotpCode", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = currentTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });
});

describe("totpUri", () => {
  it("produces a well-formed otpauth:// URI with the expected parameters", () => {
    const uri = totpUri("ABCDEFGHIJKLMNOP", "admin@example.com", "PLUG");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=ABCDEFGHIJKLMNOP");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(uri).toContain(encodeURIComponent("PLUG:admin@example.com"));
  });

  it("URL-encodes special characters in the label", () => {
    const uri = totpUri("SECRET", "user+test@example.com", "My Store");
    expect(uri).toContain(encodeURIComponent("My Store:user+test@example.com"));
  });
});
