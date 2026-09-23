import { withRoute, json } from "@/lib/http";
import { validateBody, required, isPositiveInt } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateCartItemQuantity, removeCartItem } from "@/lib/services/cart.service";

export const PATCH = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { quantity } = validateBody(body, { quantity: required(isPositiveInt) });
  const cart = await updateCartItemQuantity(user!.id, params.itemId!, quantity);
  return json({ cart });
});

export const DELETE = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  const cart = await removeCartItem(user!.id, params.itemId!);
  return json({ cart });
});
