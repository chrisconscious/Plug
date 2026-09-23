import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAuditEvents } from "@/lib/audit";

export const GET = withRoute({ permission: "activity_logs.read", rateLimit: RateLimitRules.adminGeneral }, async ({ req }) => {
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100));
  return json({ events: await listAuditEvents(limit) });
});
