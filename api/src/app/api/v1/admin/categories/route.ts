import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAdminCategories, createCategory } from "@/lib/services/catalog.service";

/**
 * GET here was previously `auth: "none"` despite living under /admin/ —
 * a real pre-existing inconsistency fixed as part of adding genuine
 * admin category management: the public storefront already has its own
 * route (GET /api/v1/categories) that correctly shows only active
 * categories; THIS route is admin-only and must show every category
 * (active and inactive) so an admin can find and re-enable a hidden one.
 */
export const GET = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ categories: await listAdminCategories() });
});

export const POST = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const input = validateBody(body, {
    name: required(isString),
    slug: optional(isString),
    icon: optional(isString),
  });
  const category = await createCategory(user!, input);
  return json({ category }, { status: 201 });
});
