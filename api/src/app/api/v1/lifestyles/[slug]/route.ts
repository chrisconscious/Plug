import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getLifestyleBySlugPublic } from "@/lib/services/lifestyles.service";

// `[slug]` is the readable, SEO-friendly lifestyle URL (/lifestyle/:slug).
// Inactive or unknown slugs 404 (deactivated lifestyles vanish from links).
const PAGE_CACHE = "public, max-age=60";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ params }) => {
  const lifestyle = await getLifestyleBySlugPublic(params.slug!);
  return json({ lifestyle }, { cache: PAGE_CACHE });
});