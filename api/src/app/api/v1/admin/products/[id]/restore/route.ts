import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { restoreProduct } from "@/lib/services/catalog.service";

/** Un-archives a deleted product back to DRAFT (same permission as deleting it). */
export const POST = withRoute({ permission: "products.delete", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  const product = await restoreProduct(user!, params.id!);
  return json({ product });
});
