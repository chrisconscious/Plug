import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAllAnnouncements, createAnnouncement } from "@/lib/services/announcements.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ announcements: await listAllAnnouncements() });
});

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const announcement = await createAnnouncement(user!, body);
  return json({ announcement }, { status: 201 });
});
