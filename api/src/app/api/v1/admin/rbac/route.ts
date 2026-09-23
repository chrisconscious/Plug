import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, permissionsForRole } from "@/lib/rbac";
import { listAdmins } from "@/lib/services/admin.service";

/**
 * Read-only view of the RBAC matrix for the Roles & Permissions screen.
 *
 * Serves the single source of truth (src/lib/rbac.ts) — not the DB
 * reference tables, which are documented as an auditable copy and are NOT
 * the enforcement path. The permission → description mapping and the
 * per-role allow-lists therefore always match what the server actually
 * enforces, even if a deployment's reference tables lag behind.
 *
 * Membership (which admin accounts hold which role) is folded in so the
 * screen can show tasks, counts, and quick "change role" actions in one
 * place without a second round-trip.
 */
export const GET = withRoute({ permission: "system.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const admins = await listAdmins();

  const roles = (["SUPER_ADMIN", "ADMIN", "CUSTOMER"] as const).map((role) => ({
    role,
    label: ROLE_LABELS[role].label,
    description: ROLE_LABELS[role].description,
    admin: ROLE_LABELS[role].admin,
    permissions: permissionsForRole(role),
    members: admins.filter((a) => a.role === role).map((a) => ({ id: a.id, email: a.email, disabled: a.disabled })),
  }));

  const permissions = PERMISSIONS.map((code) => ({
    code,
    description: PERMISSION_LABELS[code] ?? code,
  }));

  return json({ permissions, roles });
});