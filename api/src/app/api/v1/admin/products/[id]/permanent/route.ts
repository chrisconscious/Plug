import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { permanentlyDeleteProduct } from "@/lib/services/catalog.service";

/** Permanently deletes an ARCHIVED product (Super Admin only — enforced in the service). */
export const DELETE = withRoute({ permission: "products.delete", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await permanentlyDeleteProduct(user!, params.id!);
  return json({ success: true });
});
