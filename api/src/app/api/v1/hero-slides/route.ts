import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActiveHeroSlides } from "@/lib/services/hero.service";

// Public hero slides are cacheable — the homepage carousel re-fetches but CDNs
// / browsers may serve repeats without hitting Postgres.
const PAGE_CACHE = "public, max-age=30";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const slides = await listActiveHeroSlides();
  return json({ slides }, { cache: PAGE_CACHE });
});
