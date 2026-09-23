import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { removeFromWishlist } from "@/lib/services/wishlist.service";

export const DELETE = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  const wishlist = await removeFromWishlist(user!.id, params.productId!);
  return json({ wishlist });
});
