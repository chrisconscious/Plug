import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getBrandBySlug } from "@/lib/services/catalog.service";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async ({ params }) => {
  return json(await getBrandBySlug(params.slug ?? ""));
});
