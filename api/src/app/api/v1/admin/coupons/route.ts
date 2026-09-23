import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listCoupons, createCoupon } from "@/lib/services/coupons.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const coupons = await listCoupons();
  return json({ coupons });
});

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const coupon = await createCoupon(user!, body);
  return json({ coupon }, { status: 201 });
});
