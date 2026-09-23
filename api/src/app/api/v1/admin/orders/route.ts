import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllOrders } from "@/lib/services/order.service";

export const GET = withRoute({ permission: "orders.read", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ orders: await listAllOrders() });
});
