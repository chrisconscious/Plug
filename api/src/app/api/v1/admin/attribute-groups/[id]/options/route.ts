import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listOptionsForGroup, createAttributeOption } from "@/lib/services/attribute.service";

export const GET = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ params }) => {
  return json({ options: await listOptionsForGroup(params.id!) });
});

export const POST = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const option = await createAttributeOption(user!, params.id!, body);
  return json({ option }, { status: 201 });
});
