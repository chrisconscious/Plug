import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getCart } from "@/lib/services/cart.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  return json({ cart: await getCart(user!.id) });
});
