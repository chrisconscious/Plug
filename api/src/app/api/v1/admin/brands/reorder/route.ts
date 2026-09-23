import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { reorderBrands, listBrands } from "@/lib/services/catalog.service";

export const PUT = withRoute({ permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = (await req.json().catch(() => ({}))) as { orderedIds?: unknown };
  await reorderBrands(user!, Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []);
  return json({ brands: await listBrands() });
});
