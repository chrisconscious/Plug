import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActiveFooterContactLinks } from "@/lib/services/footer.service";

const CACHE = "public, max-age=300";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const links = await listActiveFooterContactLinks();
  return json({ links }, { cache: CACHE });
});
