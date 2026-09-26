import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listBrands } from "@/lib/services/catalog.service";

// Stable storefront taxonomy (admin-edited, infrequent changes). A longer TTL
// lets proxies/browsers serve these without re-querying Postgres each time.
// Revalidate every time so a brand/category an admin just created shows up
// immediately (in the storefront and in the admin product form dropdowns).
const TAXONOMY_CACHE = "no-cache";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const brands = (await listBrands()).filter((b) => b.active);
  return json({ brands }, { cache: TAXONOMY_CACHE });
});
