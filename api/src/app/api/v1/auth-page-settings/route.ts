import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getAuthPageSettings } from "@/lib/services/auth-page-settings.service";

const CACHE = "public, max-age=300";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const settings = await getAuthPageSettings();
  return json({ settings }, { cache: CACHE });
});