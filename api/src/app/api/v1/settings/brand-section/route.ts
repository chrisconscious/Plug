import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getBrandSectionSettings } from "@/lib/services/brand-settings.service";

// Public brand-section settings are cacheable — the storefront marquee
// re-fetches but CDNs / browsers may serve repeats without hitting Postgres.
// The TTL is deliberately short (15s) so an admin speed change reaches the
// homepage quickly while repeats still avoid a database hit.
const PAGE_CACHE = "public, max-age=15";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  return json(await getBrandSectionSettings(), { cache: PAGE_CACHE });
});