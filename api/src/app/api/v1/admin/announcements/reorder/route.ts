import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { reorderAnnouncements } from "@/lib/services/announcements.service";

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  await reorderAnnouncements(user!, body.orderedIds);
  return json({ success: true });
});
