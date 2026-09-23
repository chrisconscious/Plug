import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getProductBySlug } from "@/lib/services/catalog.service";

// `[id]` is treated as the product SLUG (readable, SEO-friendly URLs).
export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ params }) => {
  const product = await getProductBySlug(params.id!);
  return json({ product });
});
