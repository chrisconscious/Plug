import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateFooterContactLink } from "@/lib/services/footer.service";

/** PATCH only — the six platform rows are fixed at the schema level (migration 0046); there is no create/delete here, only editing an existing row's value/active/order. */
export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const link = await updateFooterContactLink(user!, params.platform, body);
  return json({ link });
});
