import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listBrands } from "@/lib/services/catalog.service";

// Stable storefront taxonomy (admin-edited, infrequent changes). A longer TTL
// lets proxies/browsers serve these without re-querying Postgres each time.
const TAXONOMY_CACHE = "public, max-age=600";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const brands = (await listBrands()).filter((b) => b.active);
  return json({ brands }, { cache: TAXONOMY_CACHE });
});
