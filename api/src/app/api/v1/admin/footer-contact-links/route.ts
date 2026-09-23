import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllFooterContactLinks } from "@/lib/services/footer.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const links = await listAllFooterContactLinks();
  return json({ links });
});
