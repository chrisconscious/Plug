import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { permanentlyDeleteProduct } from "@/lib/services/catalog.service";

/** Permanently deletes an ARCHIVED product (needs "products.purge": Super Admins, or Admins granted it). */
export const DELETE = withRoute({ permission: "products.purge", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await permanentlyDeleteProduct(user!, params.id!);
  return json({ success: true });
});
