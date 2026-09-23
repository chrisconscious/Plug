import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getOrderForUser } from "@/lib/services/order.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  const order = await getOrderForUser(user!.id, params.id!);
  return json({ order });
});
