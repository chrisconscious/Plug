import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listMyNotifications } from "@/lib/services/notifications.service";

export const GET = withRoute({ auth: "required", rateLimit: RateLimitRules.general }, async ({ req, user }) => {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20));
  const { items, total } = await listMyNotifications(user!.id, user!.role, page, pageSize);
  return json({ notifications: items, total, page, pageSize });
});
