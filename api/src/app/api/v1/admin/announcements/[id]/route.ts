import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { updateAnnouncement, deleteAnnouncement } from "@/lib/services/announcements.service";

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const announcement = await updateAnnouncement(user!, params.id!, body);
  return json({ announcement });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  await deleteAnnouncement(user!, params.id!);
  return json({ success: true });
});
