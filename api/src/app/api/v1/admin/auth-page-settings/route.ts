import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getAuthPageSettings, updateAuthPageSettings } from "@/lib/services/auth-page-settings.service";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const settings = await getAuthPageSettings();
  return json({ settings });
});

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const settings = await updateAuthPageSettings(user!, body);
  return json({ settings });
});