import { withRoute, json } from "@/lib/http";
import { validateBody, required, isStringArray, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getAdminPermissions, grantAdminPermissions } from "@/lib/services/admin.service";

/**
 * Per-admin permission grants — the "give an Admin exactly these extra
 * permissions" surface of the permissions module.
 *
 *   GET  /api/v1/super-admin/admins/:id/permissions
 *        → the admin plus its current per-admin grant codes.
 *   PUT  /api/v1/super-admin/admins/:id/permissions
 *        → replace the whole grant set (bulk). Requires actor password.
 *
 * Both are SUPER_ADMIN-only (`permission: "admins.manage"` — and since
 * `admins.manage` is itself NON_GRANTABLE, only actual Super Admins ever
 * satisfy it). The grant set is an overlay on the role matrix in rbac.ts;
 * revoking a code only removes the *grant*, never a role-based permission.
 */
export const GET = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  const result = await getAdminPermissions(params.id!);
  return json(result);
});

export const PUT = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { permissions, actorPassword } = validateBody(body, {
    permissions: required(isStringArray),
    actorPassword: required(isString),
  });
  const admin = await grantAdminPermissions(user!, params.id!, permissions, actorPassword);
  return json({ admin });
});