import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { markMyNotificationRead } from "@/lib/services/notifications.service";

export const PUT = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user, params }) => {
  await markMyNotificationRead(user!.id, user!.role, params.id!);
  return json({ success: true });
});
