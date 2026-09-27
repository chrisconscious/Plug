import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getLowStock, getSalesReport, parseGranularity } from "@/lib/services/reports.service";

// Sales / orders / products report for a period (?granularity=daily|weekly|monthly).
// Same permission as the dashboard numbers: orders.read (Admin + Super Admin).
export const GET = withRoute({ permission: "orders.read", rateLimit: RateLimitRules.adminGeneral }, async ({ req }) => {
  const granularity = parseGranularity(req.nextUrl.searchParams.get("granularity"));
  const [report, lowStock] = await Promise.all([getSalesReport(granularity), getLowStock(25)]);
  return json({ ...report, lowStock });
});
