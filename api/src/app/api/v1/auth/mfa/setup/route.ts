import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { beginMfaSetup } from "@/lib/services/auth.service";

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.mfaManagement }, async ({ user }) => {
  const { secret, otpauthUri } = await beginMfaSetup(user!.id);
  return json({ secret, otpauthUri });
});
