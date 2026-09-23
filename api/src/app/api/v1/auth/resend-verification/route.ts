import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { requestEmailVerification } from "@/lib/services/auth.service";

export const POST = withRoute(
  { auth: "required", rateLimit: RateLimitRules.resendVerification },
  async ({ user }) => {
    await requestEmailVerification(user!.id);
    return json({ success: true });
  }
);
