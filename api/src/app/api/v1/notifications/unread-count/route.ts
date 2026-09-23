import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getMyUnreadCount } from "@/lib/services/notifications.service";

/** Deliberately its own tiny endpoint, not derived from the full list — this is what the header bell polls, and it must stay cheap (two small COUNT queries, see notifications.repo.ts) regardless of polling frequency. */
export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ user }) => {
  const count = await getMyUnreadCount(user!.id, user!.role);
  return json({ count });
});
