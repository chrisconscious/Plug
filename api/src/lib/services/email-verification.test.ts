import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/users.repo", () => ({
  findUserById: vi.fn(),
  markEmailVerified: vi.fn(),
}));
vi.mock("../db/repos/email-verification.repo", () => ({
  insertToken: vi.fn(),
  findByPlaintextToken: vi.fn(),
  consumeToken: vi.fn(),
}));
vi.mock("../email", () => ({ sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));

import * as usersRepo from "../db/repos/users.repo";
import * as verificationRepo from "../db/repos/email-verification.repo";
import { sendVerificationEmail } from "../email";
import { verifyEmail, requestEmailVerification } from "./auth.service";

function fakeUser(overrides: Partial<Awaited<ReturnType<typeof usersRepo.findUserById>>> = {}) {
  return {
    id: "user-1", email: "real@example.com", fullName: null, passwordHash: "hash",
    role: "CUSTOMER" as const, disabled: false, emailVerified: false,
    totpSecret: null, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(usersRepo.findUserById).mockReset();
  vi.mocked(usersRepo.markEmailVerified).mockReset();
  vi.mocked(verificationRepo.insertToken).mockReset();
  vi.mocked(verificationRepo.findByPlaintextToken).mockReset();
  vi.mocked(verificationRepo.consumeToken).mockReset();
  vi.mocked(sendVerificationEmail).mockReset();
});

describe("requestEmailVerification", () => {
  it("sends an email containing the PLAINTEXT token, not the row id", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser());
    vi.mocked(verificationRepo.insertToken).mockResolvedValue({
      token: { id: "row-id-1", userId: "user-1", expiresAt: "2026-01-02T00:00:00Z", consumedAt: null, createdAt: "2026-01-01T00:00:00Z" },
      plaintextToken: "the-real-plaintext-secret-xyz789",
    });

    await requestEmailVerification("user-1");

    expect(sendVerificationEmail).toHaveBeenCalledWith("real@example.com", expect.stringContaining("the-real-plaintext-secret-xyz789"));
    expect(sendVerificationEmail).not.toHaveBeenCalledWith("real@example.com", expect.stringContaining("row-id-1"));
  });

  it("is a no-op (does not send another email) if the account is already verified", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser({ emailVerified: true }));
    await requestEmailVerification("user-1");
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(verificationRepo.insertToken).not.toHaveBeenCalled();
  });
});

describe("verifyEmail", () => {
  const validToken = { id: "row-id-1", userId: "user-1", expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: null, createdAt: "2026-01-01T00:00:00Z" };

  it("marks the account verified when given the correct plaintext token", async () => {
    vi.mocked(verificationRepo.findByPlaintextToken).mockResolvedValue(validToken);

    await verifyEmail("the-real-plaintext-secret");

    expect(verificationRepo.findByPlaintextToken).toHaveBeenCalledWith("the-real-plaintext-secret");
    expect(verificationRepo.consumeToken).toHaveBeenCalledWith("row-id-1");
    expect(usersRepo.markEmailVerified).toHaveBeenCalledWith("user-1");
  });

  it("rejects an unknown token", async () => {
    vi.mocked(verificationRepo.findByPlaintextToken).mockResolvedValue(null);
    await expect(verifyEmail("nonexistent")).rejects.toThrow();
    expect(usersRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it("rejects an already-consumed (single-use) token", async () => {
    vi.mocked(verificationRepo.findByPlaintextToken).mockResolvedValue({ ...validToken, consumedAt: "2026-01-01T00:30:00Z" });
    await expect(verifyEmail("used-token")).rejects.toThrow();
    expect(usersRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    vi.mocked(verificationRepo.findByPlaintextToken).mockResolvedValue({ ...validToken, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(verifyEmail("expired-token")).rejects.toThrow();
    expect(usersRepo.markEmailVerified).not.toHaveBeenCalled();
  });
});
