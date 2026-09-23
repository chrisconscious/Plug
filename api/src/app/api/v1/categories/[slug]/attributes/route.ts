import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAttributeGroupsForCategorySlug } from "@/lib/services/attribute.service";

// Public, cacheable — slug-addressed to match every other public
// storefront route in this app (/products/{slug}, /lifestyle/{slug}).
// This is the exact query that lets a category page show only its
// relevant attributes (e.g. Fit/Rise/Leg Style for Jeans) with zero
// hardcoded category logic anywhere in the frontend.
const TAXONOMY_CACHE = "public, max-age=300";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ params }) => {
  const groups = await listAttributeGroupsForCategorySlug(params.slug!);
  return json({ groups }, { cache: TAXONOMY_CACHE });
});
