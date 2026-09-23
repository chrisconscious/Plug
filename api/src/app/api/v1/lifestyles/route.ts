import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listLifestylesPublic } from "@/lib/services/lifestyles.service";

// Public lifestyle list is cacheable — the homepage section re-fetches but
// CDNs / browsers may serve repeats without hitting Postgres (same policy as
// hero slides).
const PAGE_CACHE = "public, max-age=30";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const items = await listLifestylesPublic();
  return json({ items }, { cache: PAGE_CACHE });
});