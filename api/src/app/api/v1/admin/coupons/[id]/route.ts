import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateCoupon, deleteCoupon } from "@/lib/services/coupons.service";

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const coupon = await updateCoupon(user!, params.id!, body);
  return json({ coupon });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteCoupon(user!, params.id!);
  return json({ success: true });
});
