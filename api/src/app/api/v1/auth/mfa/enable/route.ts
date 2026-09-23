import { withRoute, json } from "@/lib/http";
import { validateBody, isString, required } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { enableMfa } from "@/lib/services/auth.service";

export const POST = withRoute({ auth: "required", rateLimit: RateLimitRules.mfaManagement }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { code } = validateBody(body, { code: required(isString) });
  const { recoveryCodes } = await enableMfa(user!.id, code);
  // Shown to the admin exactly once — the backend never returns these
  // again (only hashes are stored, see mfa-recovery.repo.ts).
  return json({ recoveryCodes });
});
