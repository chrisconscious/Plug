import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActiveFooterContactLinks } from "@/lib/services/footer.service";

// Short so an admin's change to a WhatsApp/social link shows on the storefront
// within a minute rather than five.
const CACHE = "public, max-age=60";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const links = await listActiveFooterContactLinks();
  return json({ links }, { cache: CACHE });
});
