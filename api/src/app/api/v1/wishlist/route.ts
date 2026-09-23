import { withRoute, json } from "@/lib/http";
import { validateBody, required, isString } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getWishlist, addToWishlist } from "@/lib/services/wishlist.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  return json({ wishlist: await getWishlist(user!.id) });
});

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { productId } = validateBody(body, { productId: required(isString) });
  const wishlist = await addToWishlist(user!.id, productId);
  return json({ wishlist }, { status: 201 });
});
