import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/users.repo", () => ({
  findUserById: vi.fn(),
  clearMfa: vi.fn(),
}));
vi.mock("../db/repos/mfa-recovery.repo", () => ({
  deleteAllRecoveryCodes: vi.fn(),
}));
vi.mock("../security/password", () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as usersRepo from "../db/repos/users.repo";
import * as recoveryRepo from "../db/repos/mfa-recovery.repo";
import { verifyPassword } from "../security/password";
import { recordAuditEvent } from "../audit";
import { disableMfa } from "./auth.service";

function fakeUser(overrides: Partial<{ id: string; role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN" }> = {}) {
  return {
    id: "admin-1", email: "admin@example.com", fullName: null, passwordHash: "hashed-password",
    role: "ADMIN" as const, disabled: false, emailVerified: true, totpSecret: "secret",
    mfaEnabled: true, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(usersRepo.findUserById).mockReset();
  vi.mocked(usersRepo.clearMfa).mockReset();
  vi.mocked(recoveryRepo.deleteAllRecoveryCodes).mockReset();
  vi.mocked(verifyPassword).mockReset();
  vi.mocked(recordAuditEvent).mockReset();
});

describe("disableMfa", () => {
  it("clears MFA and all recovery codes, and audit-logs the event, when the password is correct", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser());
    vi.mocked(verifyPassword).mockResolvedValue(true);

    await disableMfa("admin-1", "correct-password");

    expect(usersRepo.clearMfa).toHaveBeenCalledWith("admin-1");
    expect(recoveryRepo.deleteAllRecoveryCodes).toHaveBeenCalledWith("admin-1");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.mfa_disabled", targetType: "user", targetId: "admin-1" })
    );
  });

  it("rejects an incorrect password and does NOT clear MFA or recovery codes", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser());
    vi.mocked(verifyPassword).mockResolvedValue(false);

    await expect(disableMfa("admin-1", "wrong-password")).rejects.toThrow(/incorrect password/i);
    expect(usersRepo.clearMfa).not.toHaveBeenCalled();
    expect(recoveryRepo.deleteAllRecoveryCodes).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects if the user no longer exists", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(null);
    await expect(disableMfa("nonexistent", "any-password")).rejects.toThrow();
    expect(usersRepo.clearMfa).not.toHaveBeenCalled();
  });
});
