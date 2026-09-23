import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listCategories, listGenderCategories, listGenderCategoriesWithAttributes } from "@/lib/services/catalog.service";

// Stable storefront taxonomy (admin-edited, infrequent changes). A longer TTL
// lets proxies/browsers serve these without re-querying Postgres each time.
const TAXONOMY_CACHE = "public, max-age=600";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ req }) => {
  const url = new URL(req.url);
  const gender = url.searchParams.get("gender");
  if (gender) {
    // "Shop by Category" within an audience — real DISTINCT category↔gender
    // counts (never a hardcoded list), used by the listing showcase.
    if (url.searchParams.get("withAttributes") === "1") {
      // Header mega-menu payload — categories PLUS the attribute groups that
      // apply to each, so a WOMEN dropdown can show Fit/Rise per category.
      return json({ categories: await listGenderCategoriesWithAttributes(gender) }, { cache: TAXONOMY_CACHE });
    }
    return json({ categories: await listGenderCategories(gender) }, { cache: TAXONOMY_CACHE });
  }
  return json({ categories: await listCategories() }, { cache: TAXONOMY_CACHE });
});