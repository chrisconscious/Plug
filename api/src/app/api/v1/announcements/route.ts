import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listActiveAnnouncements } from "@/lib/services/announcements.service";

const CACHE = "public, max-age=60";

export const GET = withRoute({ auth: "none", rateLimit: RateLimitRules.general }, async () => {
  const announcements = await listActiveAnnouncements();
  return json({ announcements }, { cache: CACHE });
});
