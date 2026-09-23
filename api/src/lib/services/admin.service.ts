import * as usersRepo from "../db/repos/users.repo";
import { hashPassword, verifyPassword } from "../security/password";
import { revokeAllSessionsForUser } from "../security/tokens";
import { NotFoundError, ValidationError, AuthenticationError } from "../errors";
import { recordAuditEvent } from "../audit";
import type { Role } from "../rbac";
import * as adminPermissionsRepo from "../db/repos/admin-permissions.repo";
import type { User } from "../db/types";

function toSafeAdmin(user: User) {
  return { id: user.id, email: user.email, role: user.role, disabled: user.disabled, createdAt: user.createdAt };
}

/**
 * Re-verifies the ACTOR's own current password — required before any of
 * the especially sensitive operations below (creating a new privileged
 * account, changing a role, disabling/enabling an admin). A valid
 * session alone is not enough here: a hijacked session (stolen cookie,
 * XSS, a coerced browser) should not be able to freely mint new
 * super-admin accounts or change roles with zero additional friction —
 * this is the same "prove you're still you" bar already applied to
 * disabling MFA (see auth.service.ts's disableMfa).
 */
async function reauthenticate(actorId: string, actorPassword: string): Promise<void> {
  const actor = await usersRepo.findUserById(actorId);
  if (!actor) throw new AuthenticationError();
  const ok = await verifyPassword(actorPassword, actor.passwordHash);
  if (!ok) throw new AuthenticationError("Incorrect password. Please re-enter your password to confirm this action.");
}

/** Only SUPER_ADMIN may call these (enforced via `permission: "admins.manage"` in the route). */
export async function listAdmins() {
  return (await usersRepo.listAdminUsers()).map(toSafeAdmin);
}

export async function createAdmin(
  actor: { id: string; role: Role },
  input: { email: string; password: string; role: "ADMIN" | "SUPER_ADMIN"; actorPassword: string }
) {
  await reauthenticate(actor.id, input.actorPassword);

  // insertUser() relies on the DB's UNIQUE index on email — see
  // users.repo.ts — and raises ConflictError on a duplicate.
  const user = await usersRepo.insertUser({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
  });

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "admin.created",
    targetType: "user",
    targetId: user.id,
    metadata: { role: user.role },
  });
  return toSafeAdmin(user);
}

export async function setAdminDisabled(actor: { id: string; role: Role }, targetUserId: string, disabled: boolean, actorPassword: string) {
  if (targetUserId === actor.id && disabled) {
    throw new ValidationError("You cannot disable your own account.");
  }
  await reauthenticate(actor.id, actorPassword);

  const target = await usersRepo.setUserDisabled(targetUserId, disabled);
  if (!target) throw new NotFoundError("Admin not found.");

  if (disabled) await revokeAllSessionsForUser(target.id); // immediately kick out any active sessions

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: disabled ? "admin.disabled" : "admin.enabled",
    targetType: "user",
    targetId: target.id,
  });
  return toSafeAdmin(target);
}

export async function changeAdminRole(actor: { id: string; role: Role }, targetUserId: string, role: "ADMIN" | "SUPER_ADMIN", actorPassword: string) {
  if (targetUserId === actor.id) {
    throw new ValidationError("You cannot change your own role.");
  }
  await reauthenticate(actor.id, actorPassword);

  const before = await usersRepo.findUserById(targetUserId);
  if (!before) throw new NotFoundError("Admin not found.");

  const target = await usersRepo.setUserRole(targetUserId, role);
  if (!target) throw new NotFoundError("Admin not found.");

  await revokeAllSessionsForUser(target.id); // force re-login so the new role takes effect via a fresh token

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "admin.role_changed",
    targetType: "user",
    targetId: target.id,
    metadata: { from: before.role, to: role },
  });
  return toSafeAdmin(target);
}

/**
 * Returns an admin's account material plus their per-admin grants (from
 * admin_permissions). Used by the Super Admin "permissions" screen.
 * Role-based permissions come from rbac.ts directly on the frontend.
 */
export async function getAdminPermissions(targetUserId: string) {
  const user = await usersRepo.findUserById(targetUserId);
  if (!user) throw new NotFoundError("Admin not found.");
  const grants = await adminPermissionsRepo.listGrantedPermissions(targetUserId);
  return {
    admin: toSafeAdmin(user),
    grants: grants.map((g) => ({ permissionCode: g.permissionCode, grantedAt: g.grantedAt, grantedBy: g.grantedByEmail })),
  };
}

export async function grantAdminPermissions(
  actor: { id: string; role: Role },
  targetUserId: string,
  permissionCodes: string[],
  actorPassword: string
) {
  // permissionCodes.length === 0 is a genuinely valid, intentional case
  // here — it means "revoke every extra grant this admin has," not "no
  // input was provided" (validateBody's isStringArray already allows an
  // empty array through for exactly this reason). This function replaces
  // the WHOLE grant set (see the route's own doc comment), so zero codes
  // is a real, meaningful target state, not something to reject.
  if (targetUserId === actor.id) {
    throw new ValidationError("You cannot modify your own permissions.");
  }
  await reauthenticate(actor.id, actorPassword);

  const target = await usersRepo.findUserById(targetUserId);
  if (!target) throw new NotFoundError("Admin not found.");
  if (target.role !== "ADMIN") {
    throw new ValidationError("Only Admin accounts can be granted permissions.");
  }

  // Verify every code is a real, grantable permission code (source of
  // truth is rbac.ts; the grants table just stores the FK-backed codes).
  const { isGrantablePermission } = await import("../rbac");
  for (const code of permissionCodes) {
    if (!isGrantablePermission(code)) {
      throw new ValidationError("Validation failed.", { permissions: `Cannot grant: ${code}` });
    }
  }

  await adminPermissionsRepo.setGrantedPermissions(targetUserId, permissionCodes, actor.id);

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "admin.permissions_updated",
    targetType: "user",
    targetId: targetUserId,
    metadata: { permissions: permissionCodes },
  });

  return toSafeAdmin(target);
}
