import { withRoute, json } from "@/lib/http";
import { validateBody, isString, required } from "@/lib/validate";
import { verifyEmail } from "@/lib/services/auth.service";
import { RateLimitRules } from "@/lib/security/rateLimiter";

// Public: the whole point is that a signed-out (or different-browser)
// click on the emailed link works, so this can't require an active session.
// Rate-limited even though the token itself is 256 bits of entropy
// (practically unguessable regardless) — defense-in-depth against
// resource exhaustion, and consistency with every other auth endpoint
// here (login, register, password reset all have their own limits).
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.passwordReset }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { token } = validateBody(body, { token: required(isString) });
  await verifyEmail(token);
  return json({ success: true });
});
