import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { setBroadcastActive } from "@/lib/services/notifications.service";

export const PUT = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  await setBroadcastActive(user!, params.id!, Boolean(body?.active));
  return json({ success: true });
});
