import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAttributeGroupsForCategorySlugs } from "@/lib/services/attribute.service";

// Public, cacheable. Read-only, slug-addressed like every public storefront
// route — the batched sibling of categories/[slug]/attributes for contexts
// that span SEVERAL categories at once (a Brand page's attribute shelf, the
// header mega-menu). ?for=jeans,trousers resolves each slug, collects the
// DISTINCT active groups (with options) that apply to any of them, and
// returns them de-duplicated by id — two DB queries total, never one per
// slug.
const TAXONOMY_CACHE = "public, max-age=300";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ req }) => {
  const url = new URL(req.url);
  const slugs = (url.searchParams.get("for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return json({ groups: await listAttributeGroupsForCategorySlugs(slugs) }, { cache: TAXONOMY_CACHE });
});