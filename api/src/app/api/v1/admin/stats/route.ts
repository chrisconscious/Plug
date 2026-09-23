import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getAdminStats } from "@/lib/services/stats.service";

export const GET = withRoute({ permission: "orders.read", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json(await getAdminStats());
});
