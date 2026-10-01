import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { DEFAULT_SUGGEST_LIMIT, searchProducts, searchStart } from "@/lib/services/search.service";
import { MAX_SEARCH_LENGTH } from "@/lib/db/repos/product-filter.repo";

/**
 * Live search for the storefront search panel.
 *   GET /api/v1/search            -> starting state (popular searches, top brands/categories, new arrivals)
 *   GET /api/v1/search?q=...&limit=8 -> ranked live products + matching brands/categories + suggested searches
 * Public, read-only, live products only. Stock and prices change, so never cached.
 */
export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.searchSuggest }, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, MAX_SEARCH_LENGTH).trim();
  const limit = Number(sp.get("limit") ?? DEFAULT_SUGGEST_LIMIT);
  if (!q) return json(await searchStart(), { cache: "no-cache" });
  return json(await searchProducts(q, limit), { cache: "no-cache" });
});
