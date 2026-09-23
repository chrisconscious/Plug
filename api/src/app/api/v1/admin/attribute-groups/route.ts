import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllAttributeGroups, createAttributeGroup } from "@/lib/services/attribute.service";

export const GET = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ groups: await listAllAttributeGroups() });
});

export const POST = withRoute({ permission: "products.create", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const group = await createAttributeGroup(user!, body);
  return json({ group }, { status: 201 });
});
