import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listLifestylesPublic } from "@/lib/services/lifestyles.service";

// Revalidate every time so lifestyles an admin creates/edits/deactivates show
// up on the storefront immediately.
const PAGE_CACHE = "no-cache";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const items = await listLifestylesPublic();
  return json({ items }, { cache: PAGE_CACHE });
});