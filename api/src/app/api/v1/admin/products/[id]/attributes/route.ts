import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getProductAttributeOptionIds, setProductAttributeValues } from "@/lib/services/attribute.service";

export const GET = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  return json({ optionIds: await getProductAttributeOptionIds(params.id!) });
});

export const PATCH = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  await setProductAttributeValues(user!, params.id!, body.optionIds);
  return json({ success: true });
});
