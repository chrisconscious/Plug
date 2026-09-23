import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString, isPositiveInt } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getBuyNowItems } from "@/lib/services/cart.service";

// "Buy it now": returns the same item snapshot the cart serializer would,
// for ONE product the customer clicked straight to checkout with. Auth is
// required — checkout itself requires a session, so it never serves
// anonymous callers. This endpoint performs NO cart mutation.
export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { variantId, quantity } = validateBody(body, {
    variantId: required(isString),
    quantity: required(isPositiveInt),
  });
  return json({ cart: await getBuyNowItems(variantId, quantity) });
});