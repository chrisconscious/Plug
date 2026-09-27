import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getDashboardStats } from "@/lib/services/reports.service";

export const GET = withRoute({ permission: "orders.read", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json(await getDashboardStats());
});
