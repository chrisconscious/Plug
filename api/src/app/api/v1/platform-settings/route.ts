import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getPlatformSettings } from "@/lib/services/platform-settings.service";

/**
 * Public — every page (header, footer, auth pages, email templates,
 * title metadata) needs this to render the current brand identity.
 * Nothing here is sensitive; there is no reason to gate it behind auth.
 */
export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const settings = await getPlatformSettings();
  return json({ settings });
});
