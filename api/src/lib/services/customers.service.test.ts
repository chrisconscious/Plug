import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/repos/users.repo", () => ({
  findUserById: vi.fn(),
  findUserAccountMeta: vi.fn(),
  deleteOrAnonymizeCustomer: vi.fn(),
}));
vi.mock("../db/repos/addresses.repo", () => ({ listAddressesForUser: vi.fn(async () => []) }));
vi.mock("../db/repos/orders.repo", () => ({ listOrdersForUser: vi.fn(async () => []) }));
vi.mock("../audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("./admin.service", () => ({ reauthenticate: vi.fn(async () => undefined) }));

import * as usersRepo from "../db/repos/users.repo";
import { listOrdersForUser } from "../db/repos/orders.repo";
import { reauthenticate } from "./admin.service";
import { recordAuditEvent } from "../audit";
import { deleteCustomerAccount, getUserDetails } from "./customers.service";

const superAdmin = { id: "s1", role: "SUPER_ADMIN" as const };
const customer = { id: "c1", role: "CUSTOMER", email: "c@x.tz", phoneNumber: "0655000000", fullName: "Asha", passwordHash: "h", totpSecret: "secret", disabled: false, emailVerified: false, mfaEnabled: false, createdAt: "2026-01-01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usersRepo.findUserById).mockResolvedValue(customer as never);
  vi.mocked(usersRepo.findUserAccountMeta).mockResolvedValue({ lastLoginAt: null, deletedAt: null });
  vi.mocked(usersRepo.deleteOrAnonymizeCustomer).mockResolvedValue("deleted");
});

describe("deleteCustomerAccount", () => {
  it("checks the admin's password, deletes the customer and audits it", async () => {
    await expect(deleteCustomerAccount(superAdmin, "c1", "pw")).resolves.toEqual({ outcome: "deleted" });
    expect(reauthenticate).toHaveBeenCalledWith("s1", "pw");
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "user.deleted", targetId: "c1", metadata: { outcome: "deleted" } }));
  });

  it("refuses staff accounts", async () => {
    vi.mocked(usersRepo.findUserById).mockResolvedValue({ ...customer, role: "ADMIN" } as never);
    await expect(deleteCustomerAccount(superAdmin, "c1", "pw")).rejects.toThrow(/Staff accounts/);
    expect(usersRepo.deleteOrAnonymizeCustomer).not.toHaveBeenCalled();
  });

  it("refuses deleting your own account", async () => {
    await expect(deleteCustomerAccount(superAdmin, "s1", "pw")).rejects.toThrow(/your own account/);
  });

  it("does nothing without a correct password", async () => {
    vi.mocked(reauthenticate).mockRejectedValueOnce(new Error("Incorrect password."));
    await expect(deleteCustomerAccount(superAdmin, "c1", "wrong")).rejects.toThrow(/Incorrect password/);
    expect(usersRepo.deleteOrAnonymizeCustomer).not.toHaveBeenCalled();
  });
});

describe("getUserDetails", () => {
  it("never returns the password hash or MFA secret, and counts only non-cancelled orders", async () => {
    vi.mocked(listOrdersForUser).mockResolvedValue([
      { id: "o1", status: "PAID", totalTzs: 1000, items: [{ quantity: 2 }], createdAt: "2026-02-01" },
      { id: "o2", status: "CANCELLED", totalTzs: 500, items: [{ quantity: 1 }], createdAt: "2026-02-02" },
    ] as never);
    const d = await getUserDetails("c1");
    expect(JSON.stringify(d)).not.toMatch(/passwordHash|totpSecret|secret/);
    expect(d.stats).toEqual({ orderCount: 1, totalSpentTzs: 1000 });
    expect(d.orders).toHaveLength(2);
  });
});
