import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/users.repo", () => ({
  findUserById: vi.fn(),
  insertUser: vi.fn(),
  setUserDisabled: vi.fn(),
  setUserRole: vi.fn(),
  listAdminUsers: vi.fn(),
}));
vi.mock("../security/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("../security/tokens", () => ({ revokeAllSessionsForUser: vi.fn() }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));

import * as usersRepo from "../db/repos/users.repo";
import { verifyPassword } from "../security/password";
import { revokeAllSessionsForUser } from "../security/tokens";
import { recordAuditEvent } from "../audit";
import { createAdmin, setAdminDisabled, changeAdminRole } from "./admin.service";

const SUPER_ADMIN = { id: "super-1", role: "SUPER_ADMIN" as const };

function fakeUser(overrides: Partial<{ id: string; role: "ADMIN" | "SUPER_ADMIN"; disabled: boolean }> = {}) {
  return {
    id: "target-1", email: "target@example.com", fullName: null, passwordHash: "hash",
    role: "ADMIN" as const, disabled: false, emailVerified: true, totpSecret: null,
    mfaEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(usersRepo.findUserById).mockReset();
  vi.mocked(usersRepo.insertUser).mockReset();
  vi.mocked(usersRepo.setUserDisabled).mockReset();
  vi.mocked(usersRepo.setUserRole).mockReset();
  vi.mocked(verifyPassword).mockReset();
  vi.mocked(revokeAllSessionsForUser).mockReset();
  vi.mocked(recordAuditEvent).mockReset();
});

describe("changeAdminRole — self-escalation prevention", () => {
  it("refuses to change the actor's OWN role, even to a lower one (blocks any self-targeting, not just escalation)", async () => {
    await expect(changeAdminRole(SUPER_ADMIN, SUPER_ADMIN.id, "ADMIN", "any-password")).rejects.toThrow(/cannot change your own role/i);
    // Never even reaches the password check or the actual update — this
    // is blocked before either.
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(usersRepo.setUserRole).not.toHaveBeenCalled();
  });

  it("requires the actor's own current password to change someone ELSE's role", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValueOnce(fakeUser({ id: SUPER_ADMIN.id })); // reauthenticate() looks up the ACTOR
    vi.mocked(verifyPassword).mockResolvedValue(false); // wrong password

    await expect(changeAdminRole(SUPER_ADMIN, "target-1", "SUPER_ADMIN", "wrong-password")).rejects.toThrow(/incorrect password/i);
    expect(usersRepo.setUserRole).not.toHaveBeenCalled();
  });

  it("succeeds, revokes the target's sessions, and audit-logs from->to when the password is correct", async () => {
    vi.mocked(usersRepo.findUserById)
      .mockResolvedValueOnce(fakeUser({ id: SUPER_ADMIN.id })) // reauthenticate()'s actor lookup
      .mockResolvedValueOnce(fakeUser({ id: "target-1", role: "ADMIN" })); // the "before" lookup
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(usersRepo.setUserRole).mockResolvedValue(fakeUser({ id: "target-1", role: "SUPER_ADMIN" }));

    await changeAdminRole(SUPER_ADMIN, "target-1", "SUPER_ADMIN", "correct-password");

    expect(usersRepo.setUserRole).toHaveBeenCalledWith("target-1", "SUPER_ADMIN");
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith("target-1");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.role_changed", metadata: { from: "ADMIN", to: "SUPER_ADMIN" } })
    );
  });
});

describe("setAdminDisabled — self-targeting and reauthentication", () => {
  it("refuses to disable the actor's OWN account", async () => {
    await expect(setAdminDisabled(SUPER_ADMIN, SUPER_ADMIN.id, true, "any-password")).rejects.toThrow(/cannot disable your own account/i);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("requires the correct actor password before disabling someone else, and revokes their sessions on success", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser({ id: SUPER_ADMIN.id }));
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(usersRepo.setUserDisabled).mockResolvedValue(fakeUser({ id: "target-1", disabled: true }));

    await setAdminDisabled(SUPER_ADMIN, "target-1", true, "correct-password");

    expect(usersRepo.setUserDisabled).toHaveBeenCalledWith("target-1", true);
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith("target-1");
  });
});

describe("createAdmin — reauthentication before creating a new privileged account", () => {
  it("rejects creating a new admin if the actor's password is wrong", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser({ id: SUPER_ADMIN.id }));
    vi.mocked(verifyPassword).mockResolvedValue(false);

    await expect(
      createAdmin(SUPER_ADMIN, { email: "new@example.com", password: "NewPassw0rd!", role: "SUPER_ADMIN", actorPassword: "wrong" })
    ).rejects.toThrow(/incorrect password/i);
    expect(usersRepo.insertUser).not.toHaveBeenCalled();
  });

  it("creates the new admin and audit-logs it when the actor's password is correct", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue(fakeUser({ id: SUPER_ADMIN.id }));
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(usersRepo.insertUser).mockResolvedValue(fakeUser({ id: "new-admin-1", role: "SUPER_ADMIN" }));

    await createAdmin(SUPER_ADMIN, { email: "new@example.com", password: "NewPassw0rd!", role: "SUPER_ADMIN", actorPassword: "correct" });

    expect(usersRepo.insertUser).toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.created" }));
  });
});
