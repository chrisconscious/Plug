import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/users.repo", () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  updatePasswordHash: vi.fn(),
}));
vi.mock("../db/repos/password-reset.repo", () => ({
  insertToken: vi.fn(),
  findByPlaintextToken: vi.fn(),
  consumeToken: vi.fn(),
  invalidateAllForUser: vi.fn(),
}));
vi.mock("../security/tokens", async () => {
  const actual = await vi.importActual<typeof import("../security/tokens")>("../security/tokens");
  return { ...actual, revokeAllSessionsForUser: vi.fn() };
});
vi.mock("../email", () => ({ sendPasswordResetEmail: vi.fn(), sendVerificationEmail: vi.fn() }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as usersRepo from "../db/repos/users.repo";
import * as passwordResetRepo from "../db/repos/password-reset.repo";
import * as tokens from "../security/tokens";
import { sendPasswordResetEmail } from "../email";
import { requestPasswordReset, resetPassword } from "./auth.service";

function fakeUser(overrides: Partial<Awaited<ReturnType<typeof usersRepo.findUserByEmail>>> = {}) {
  return {
    id: "user-1", email: "real@example.com", fullName: null, passwordHash: "hash",
    role: "CUSTOMER" as const, disabled: false, emailVerified: true,
    totpSecret: null, mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(usersRepo.findUserByEmail).mockReset();
  vi.mocked(usersRepo.findUserById).mockReset();
  vi.mocked(usersRepo.updatePasswordHash).mockReset();
  vi.mocked(passwordResetRepo.insertToken).mockReset();
  vi.mocked(passwordResetRepo.findByPlaintextToken).mockReset();
  vi.mocked(passwordResetRepo.consumeToken).mockReset();
  vi.mocked(passwordResetRepo.invalidateAllForUser).mockReset();
  vi.mocked(tokens.revokeAllSessionsForUser).mockReset();
  vi.mocked(sendPasswordResetEmail).mockReset();
});

describe("requestPasswordReset", () => {
  it("sends an email containing the PLAINTEXT token and creates a token record for an existing account", async () => {
    vi.mocked(usersRepo.findUserByEmail).mockResolvedValue(fakeUser());
    vi.mocked(passwordResetRepo.insertToken).mockResolvedValue({
      token: { id: "token-1", userId: "user-1", expiresAt: "2026-01-01T01:00:00Z", consumedAt: null, createdAt: "2026-01-01T00:00:00Z" },
      plaintextToken: "the-real-plaintext-secret-abc123",
    });

    await requestPasswordReset("real@example.com");

    expect(passwordResetRepo.invalidateAllForUser).toHaveBeenCalledWith("user-1");
    expect(passwordResetRepo.insertToken).toHaveBeenCalled();
    // The email link must contain the PLAINTEXT token, not the row id —
    // the row id alone is no longer sufficient to use the link (see
    // migration 0028): only the plaintext value hashes to what's stored.
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("real@example.com", expect.stringContaining("the-real-plaintext-secret-abc123"));
    // And must NOT contain the row id — confirms the fix actually changed
    // what goes in the link, not just added a field nobody uses.
    expect(sendPasswordResetEmail).not.toHaveBeenCalledWith("real@example.com", expect.stringContaining("token-1"));
  });

  it("does nothing observable for a nonexistent email — no email sent, no token created, no error thrown", async () => {
    vi.mocked(usersRepo.findUserByEmail).mockResolvedValue(null);

    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();

    expect(passwordResetRepo.insertToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  const validToken = { id: "token-1", userId: "user-1", expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: null, createdAt: "2026-01-01T00:00:00Z" };

  it("sets the new password and revokes all sessions when given the correct plaintext token", async () => {
    vi.mocked(passwordResetRepo.findByPlaintextToken).mockResolvedValue(validToken);
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser());

    await resetPassword("the-real-plaintext-secret", "NewStrongPassw0rd!");

    // The service looks up by the PLAINTEXT value it was given — the
    // repo itself is responsible for hashing before querying (see
    // password-reset.repo.ts's findByPlaintextToken).
    expect(passwordResetRepo.findByPlaintextToken).toHaveBeenCalledWith("the-real-plaintext-secret");
    expect(passwordResetRepo.consumeToken).toHaveBeenCalledWith("token-1");
    expect(usersRepo.updatePasswordHash).toHaveBeenCalledWith("user-1", expect.any(String));
    expect(tokens.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
  });

  it("rejects an unknown token", async () => {
    vi.mocked(passwordResetRepo.findByPlaintextToken).mockResolvedValue(null);
    await expect(resetPassword("nonexistent", "NewStrongPassw0rd!")).rejects.toThrow();
    expect(usersRepo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("rejects an already-consumed (single-use) token", async () => {
    vi.mocked(passwordResetRepo.findByPlaintextToken).mockResolvedValue({ ...validToken, consumedAt: "2026-01-01T00:30:00Z" });
    await expect(resetPassword("token-1", "NewStrongPassw0rd!")).rejects.toThrow();
    expect(usersRepo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    vi.mocked(passwordResetRepo.findByPlaintextToken).mockResolvedValue({ ...validToken, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(resetPassword("token-1", "NewStrongPassw0rd!")).rejects.toThrow();
    expect(usersRepo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("does not revoke sessions or change the password if the token's user no longer exists", async () => {
    vi.mocked(passwordResetRepo.findByPlaintextToken).mockResolvedValue(validToken);
    vi.mocked(usersRepo.findUserById).mockResolvedValue(null);
    await expect(resetPassword("token-1", "NewStrongPassw0rd!")).rejects.toThrow();
    expect(usersRepo.updatePasswordHash).not.toHaveBeenCalled();
    expect(tokens.revokeAllSessionsForUser).not.toHaveBeenCalled();
  });
});
