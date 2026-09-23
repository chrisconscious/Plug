import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllAccordionSections, createAccordionSection } from "@/lib/services/accordion.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ sections: await listAllAccordionSections() });
});

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const section = await createAccordionSection(user!, body);
  return json({ section }, { status: 201 });
});