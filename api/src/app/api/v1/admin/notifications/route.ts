import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listBroadcasts, createBroadcast } from "@/lib/services/notifications.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const notifications = await listBroadcasts();
  return json({ notifications });
});

/** Creates a role-broadcast notification (promotional announcement, or a manually-triggered operational broadcast) — never a user-specific one, which only ever originates from a real event elsewhere in the system, not a direct admin action. */
export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const id = await createBroadcast(user!, body);
  return json({ id }, { status: 201 });
});
