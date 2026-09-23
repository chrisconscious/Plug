import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { markAllMyNotificationsRead } from "@/lib/services/notifications.service";

export const PUT = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  await markAllMyNotificationsRead(user!.id, user!.role);
  return json({ success: true });
});
