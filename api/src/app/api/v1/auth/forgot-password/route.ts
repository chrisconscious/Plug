import { withRoute, json } from "@/lib/http";
import { validateBody, isEmail, required } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { requestPasswordReset } from "@/lib/services/auth.service";

// Public — this is the whole point (a signed-out user requesting a reset).
// Rate-limited specifically (not just the general limiter) since this
// triggers an email send per request.
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.passwordReset }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { email } = validateBody(body, { email: required(isEmail) });
  await requestPasswordReset(email);
  // Same response whether or not the email exists — see
  // auth.service.ts#requestPasswordReset's doc comment.
  return json({ success: true, message: "If an account exists for that email, a reset link has been sent." });
});
