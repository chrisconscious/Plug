import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateAccordionSection, deleteAccordionSection } from "@/lib/services/accordion.service";

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const section = await updateAccordionSection(user!, params.id!, body);
  return json({ section });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteAccordionSection(user!, params.id!);
  return json({ success: true });
});