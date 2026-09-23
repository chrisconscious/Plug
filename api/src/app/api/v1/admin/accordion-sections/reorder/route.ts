import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { reorderAccordionSections } from "@/lib/services/accordion.service";

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  await reorderAccordionSections(user!, body.orderedIds);
  return json({ success: true });
});