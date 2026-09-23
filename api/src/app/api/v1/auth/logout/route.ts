import { withRoute, json } from "@/lib/http";
import { logout } from "@/lib/services/auth.service";
import { clearAuthCookies, getRefreshTokenFromRequest } from "@/lib/security/tokens";
import { RateLimitRules } from "@/lib/security/rateLimiter";

export const POST = withRoute({ auth: "optional", rateLimit: RateLimitRules.general }, async ({ req }) => {
  await logout(getRefreshTokenFromRequest(req));
  const res = json({ success: true });
  clearAuthCookies(res);
  return res;
});
