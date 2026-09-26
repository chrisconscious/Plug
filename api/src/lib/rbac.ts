/**
 * Role-based access control. Authorization is ALWAYS enforced here, in
 * server-side code that runs on every request — never inferred from
 * frontend state, hidden UI, or the presence/absence of a button.
 */

export type Role = "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

export const PERMISSIONS = [
  "products.read",
  "products.create",
  "products.update",
  "products.delete",
  "brands.manage",
  "orders.read",
  "orders.read.own",
  "orders.update",
  "users.read",
  "users.manage",
  "admins.manage",
  "activity_logs.read",
  "content.manage",
  "lifestyles.manage",
  "payment_methods.manage",
  "system.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Human-readable labels for every permission. Served by the admin RBAC
 * endpoint (`/api/v1/admin/rbac`) so the Roles & Permissions screen reads
 * this single source of truth instead of duplicating descriptions.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "products.read": "View the admin product catalog (drafts, archived, stock)",
  "products.create": "Create new products",
  "products.update": "Edit existing products",
  "products.delete": "Archive and restore products",
  "brands.manage": "Create and manage brands and categories",
  "orders.read": "View any customer's orders",
  "orders.read.own": "View only the current user's own orders",
  "orders.update": "Change order status",
  "users.read": "View customer account data",
  "users.manage": "Modify customer accounts",
  "admins.manage": "Create, disable, and change roles of Admin/Super Admin accounts",
  "activity_logs.read": "View the audit/activity log",
  "content.manage": "Manage homepage and storefront editorial content",
  "lifestyles.manage": "Manage lifestyle collections",
  "payment_methods.manage": "Manage payment methods",
  "system.manage": "Modify system-level configuration",
};

/** Display metadata per role, for the admin RBAC screen. */
export const ROLE_LABELS: Record<Role, { label: string; description: string; admin: boolean }> = {
  CUSTOMER: { label: "Customer", description: "Storefront shoppers — can browse products and view their own orders.", admin: false },
  ADMIN: { label: "Admin", description: "Day-to-day store operations: products, orders, customers, and brands.", admin: true },
  SUPER_ADMIN: { label: "Super Admin", description: "Full platform control — everything an Admin can do, plus content, payments, audit logs, admins, and system settings.", admin: true },
};

/**
 * Permissions that only a SUPER_ADMIN may hold and that a Super Admin can
 * NEVER grant to an individual Admin account via the permissions module.
 *
 * These are the "who guards the guardians" permissions: granting them would
 * let an Admin escalate their own access (create/demote accounts, edit the
 * system config, and — via this very screen — grant themselves anything
 * else). They stay exclusively on SUPER_ADMIN.
 */
export const NON_GRANTABLE_PERMISSIONS: readonly string[] = ["admins.manage", "system.manage"];

/** True if a permission may be granted to a non-super-admin account. */
export function isGrantablePermission(code: string): boolean {
  return (PERMISSIONS as readonly string[]).includes(code) && !NON_GRANTABLE_PERMISSIONS.includes(code);
}

/**
 * Explicit allow-list per role. Deliberately NOT "SUPER_ADMIN gets
 * everything automatically" — every permission is listed so the full
 * privilege surface of each role is auditable at a glance.
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // The storefront catalog is public (no permission). products.read is the
  // ADMIN catalog (drafts, archived, stock) — never a customer's (0056).
  CUSTOMER: ["orders.read.own"],
  ADMIN: [
    "products.read",
    "products.create",
    "products.update",
    // Archive/restore (never a hard delete — orders keep their history; see
    // migration 0053). Granted to Admins by the owner's decision (0055).
    "products.delete",
    "brands.manage",
    "orders.read",
    "orders.update",
    "users.read",
  ],
  SUPER_ADMIN: [
    "products.read",
    "products.create",
    "products.update",
    "products.delete",
    "brands.manage",
    "orders.read",
    "orders.update",
    "users.read",
    "users.manage",
    "admins.manage",
    "activity_logs.read",
    "content.manage",
    "lifestyles.manage",
    "payment_methods.manage",
    "system.manage",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsForRole(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Async permission check that considers both the hard-coded role matrix
 * AND per-admin grant overrides stored in `admin_permissions`.
 *
 * Evaluation order:
 * 1. SUPER_ADMIN → always true (no DB query).
 * 2. Role-based check (zero-latency, in-memory) — if true, short-circuit.
 * 3. Per-admin grant lookup (via admin-permissions.repo, 60s TTL cache),
 *    which is a pure overlay: a grant can only ever ADD a permission the
 *    role does not already have.
 *
 * Defense in depth: even if a bad row somehow reached the grants table
 * (manual DB edit, future bug in the write path), NON_GRANTABLE
 * permissions are stripped on read, so the check fails closed.
 *
 * This function is called by `withRoute()` in http.ts on every
 * permission-gated admin request.
 */
/** Role permissions plus any per-admin grants — the same set hasPermissionForUser() answers from. */
export async function effectivePermissionsForUser(userId: string, role: Role): Promise<Permission[]> {
  const base = new Set<Permission>(permissionsForRole(role));
  if (role === "ADMIN") {
    const { getGrantedPermissions } = await import("@/lib/db/repos/admin-permissions.repo");
    for (const p of await getGrantedPermissions(userId)) {
      if (!NON_GRANTABLE_PERMISSIONS.includes(p as Permission)) base.add(p as Permission);
    }
  }
  return [...base];
}

export async function hasPermissionForUser(
  userId: string,
  role: Role,
  permission: Permission
): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  if (hasPermission(role, permission)) return true;
  if (NON_GRANTABLE_PERMISSIONS.includes(permission)) return false;
  const { getGrantedPermissions } = await import("@/lib/db/repos/admin-permissions.repo");
  const grants = await getGrantedPermissions(userId);
  return grants.has(permission);
}
