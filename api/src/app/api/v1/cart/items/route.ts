import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString, isPositiveInt } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { addToCart } from "@/lib/services/cart.service";

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { variantId, quantity } = validateBody(body, {
    variantId: required(isString),
    quantity: required(isPositiveInt),
  });
  const cart = await addToCart(user!.id, variantId, quantity);
  return json({ cart }, { status: 201 });
});
