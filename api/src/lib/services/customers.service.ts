import * as usersRepo from "../db/repos/users.repo";
import { listAddressesForUser } from "../db/repos/addresses.repo";
import { listOrdersForUser } from "../db/repos/orders.repo";
import { recordAuditEvent } from "../audit";
import { reauthenticate } from "./admin.service";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Role } from "../rbac";

/** Admin view of one account: profile, saved addresses and order history. Never includes the password hash or MFA secret. */
export async function getUserDetails(userId: string) {
  const [user, meta] = await Promise.all([usersRepo.findUserById(userId), usersRepo.findUserAccountMeta(userId)]);
  if (!user || !meta) throw new NotFoundError("User not found.");
  const [addresses, orders] = await Promise.all([listAddressesForUser(userId), listOrdersForUser(userId)]);
  const placed = orders.filter((o) => o.status !== "CANCELLED");
  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
      lastLoginAt: meta.lastLoginAt,
      deletedAt: meta.deletedAt,
    },
    stats: {
      orderCount: placed.length,
      totalSpentTzs: placed.reduce((sum, o) => sum + (o.totalTzs ?? 0), 0),
    },
    addresses,
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      totalTzs: o.totalTzs,
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      createdAt: o.createdAt,
    })),
  };
}

/**
 * Deletes a customer account (needs users.manage, plus the acting admin's
 * password). Staff accounts are removed from the Admins page instead, and
 * nobody can delete their own account here. Order history is never lost:
 * see usersRepo.deleteOrAnonymizeCustomer.
 */
export async function deleteCustomerAccount(actor: { id: string; role: Role }, userId: string, actorPassword: string) {
  if (!actorPassword) throw new ValidationError("Validation failed.", { actorPassword: "Enter your password to confirm." });
  if (userId === actor.id) throw new ConflictError("You can't delete your own account.");
  const target = await usersRepo.findUserById(userId);
  if (!target) throw new NotFoundError("User not found.");
  if (target.role !== "CUSTOMER") throw new ConflictError("Staff accounts can't be deleted here. Suspend them from the Admins page instead.");
  await reauthenticate(actor.id, actorPassword);

  const outcome = await usersRepo.deleteOrAnonymizeCustomer(userId);
  if (!outcome) throw new NotFoundError("User not found.");
  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "user.deleted",
    targetType: "user",
    targetId: userId,
    metadata: { outcome },
  });
  return { outcome };
}
