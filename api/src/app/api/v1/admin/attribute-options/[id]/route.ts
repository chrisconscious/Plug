import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateAttributeOption, deleteAttributeOption } from "@/lib/services/attribute.service";

export const PATCH = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const option = await updateAttributeOption(user!, params.id!, body);
  return json({ option });
});

export const DELETE = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteAttributeOption(user!, params.id!);
  return json({ success: true });
});
