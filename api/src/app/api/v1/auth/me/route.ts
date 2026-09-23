import { withRoute, json } from "@/lib/http";
import { getPublicUser } from "@/lib/services/auth.service";
import { config } from "@/lib/config";
import { RateLimitRules } from "@/lib/security/rateLimiter";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  return json({ user: await getPublicUser(user!.id), accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds });
});
