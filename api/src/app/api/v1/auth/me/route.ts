import { withRoute, json } from "@/lib/http";
import { getPublicUser } from "@/lib/services/auth.service";
import { config } from "@/lib/config";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { effectivePermissionsForUser } from "@/lib/rbac";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  return json({
    user: await getPublicUser(user!.id),
    accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
    // Effective permissions (role + per-admin grants) so the admin UI can hide
    // actions the server would refuse anyway. Enforcement stays server-side.
    permissions: await effectivePermissionsForUser(user!.id, user!.role),
  });
});
