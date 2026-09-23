import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateAttributeGroup, deleteAttributeGroup } from "@/lib/services/attribute.service";

export const PATCH = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const group = await updateAttributeGroup(user!, params.id!, body);
  return json({ group });
});

export const DELETE = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteAttributeGroup(user!, params.id!);
  return json({ success: true });
});
