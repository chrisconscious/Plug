import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./services/platform-settings.service", () => ({ getPlatformSettings: vi.fn() }));

import { getPlatformSettings } from "./services/platform-settings.service";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";

describe("email.ts — dynamic platform name in customer-facing content", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(getPlatformSettings).mockReset();
  });

  it("sendVerificationEmail uses the LIVE configured platform name, not a hardcoded one", async () => {
    vi.mocked(getPlatformSettings).mockResolvedValue({
      platformName: "Acme Fashion", tagline: null, logoUrl: null, faviconUrl: null, updatedAt: "2026-01-01T00:00:00Z",
    });

    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");

    const logged = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(logged).toContain("Verify your Acme Fashion email address");
    expect(logged).toContain("Welcome to Acme Fashion!");
    expect(logged).not.toContain("VogueVibe");
  });

  it("sendPasswordResetEmail uses the LIVE configured platform name", async () => {
    vi.mocked(getPlatformSettings).mockResolvedValue({
      platformName: "Acme Fashion", tagline: null, logoUrl: null, faviconUrl: null, updatedAt: "2026-01-01T00:00:00Z",
    });

    await sendPasswordResetEmail("user@example.com", "https://example.com/reset?token=abc");

    const logged = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(logged).toContain("Reset your Acme Fashion password");
    expect(logged).toContain("reset your Acme Fashion password");
  });

  it("falls back to the shipped default 'PLUG' if reading platform settings fails — a transient DB hiccup must not block the email from going out with SOME sensible name", async () => {
    vi.mocked(getPlatformSettings).mockRejectedValue(new Error("connection reset"));

    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");

    const logged = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(logged).toContain("Verify your PLUG email address");
  });

  it("never writes the email body (reset/verify links) to logs in production", async () => {
    vi.mocked(getPlatformSettings).mockResolvedValue({
      platformName: "PLUG", tagline: null, logoUrl: null, faviconUrl: null, updatedAt: "2026-01-01T00:00:00Z",
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      await sendPasswordResetEmail("user@example.com", "https://example.com/reset?token=SECRET-TOKEN-123");
    } finally {
      vi.unstubAllEnvs();
    }
    const everything = [logSpy, errSpy, warnSpy].flatMap((sp) => sp.mock.calls.map((c) => c.map(String).join(" ")))
      .concat(stdout.mock.calls.map((c) => String(c[0])), stderr.mock.calls.map((c) => String(c[0])))
      .join("\n");
    stdout.mockRestore(); stderr.mockRestore(); errSpy.mockRestore(); warnSpy.mockRestore();
    expect(everything).not.toContain("SECRET-TOKEN-123");
    expect(everything).toContain("email.stub_used_in_production");
  });
});
