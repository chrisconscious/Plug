import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getPromoBannerSettings } from "@/lib/db/repos/promo-banner.repo";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const settings = await getPromoBannerSettings();
  // No row yet (fresh database, migration's seed row somehow missing) ->
  // treat as "nothing configured" rather than erroring the homepage.
  if (!settings || !settings.isActive) return json({ messages: [] });
  return json({ messages: settings.messages });
});
