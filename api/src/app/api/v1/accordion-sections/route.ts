import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActiveAccordionSections } from "@/lib/services/accordion.service";

const CACHE = "public, max-age=60";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const sections = await listActiveAccordionSections();
  return json({ sections }, { cache: CACHE });
});