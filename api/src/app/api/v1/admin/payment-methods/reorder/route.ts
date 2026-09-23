import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { reorderPaymentMethods } from "@/lib/services/payment-methods.service";

export const PUT = withRoute({ permission: "payment_methods.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = (await req.json().catch(() => ({}))) as { orderedIds?: unknown };
  const methods = await reorderPaymentMethods(user!, Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []);
  return json({ methods });
});
