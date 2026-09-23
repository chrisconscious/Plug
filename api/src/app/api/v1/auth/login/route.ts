import { withRoute, json } from "@/lib/http";
import { validateBody, isEmail, isPhoneNumber, required, isString, optional } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { loginWithPassword, loginWithPhone } from "@/lib/services/auth.service";
import { setAuthCookies } from "@/lib/security/tokens";
import { config } from "@/lib/config";

/** Phone number is the primary login field now (see migration 0037 and the register route's matching comment) — email is still accepted for any caller still using it. */
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.login }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { password, phoneNumber, email } = validateBody(body, {
    password: required(isString),
    phoneNumber: optional(isPhoneNumber),
    email: optional(isEmail),
  });

  const hasPhone = phoneNumber !== undefined;
  const hasEmail = email !== undefined;
  if (hasPhone === hasEmail) {
    throw new ValidationError("Validation failed.", { phoneNumber: "Enter your mobile number to sign in." });
  }

  const result = hasPhone
    ? await loginWithPhone(phoneNumber!, password)
    : await loginWithPassword(email!, password);

  if (result.mfaRequired) {
    // No auth cookies set yet — the caller has only proven the password,
    // not the second factor. The frontend now shows a code-entry step and
    // calls /api/v1/auth/mfa/verify-login with this token.
    return json({ mfaRequired: true, mfaToken: result.mfaToken });
  }

  const res = json({ mfaRequired: false, user: result.user, accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds });
  setAuthCookies(res, result.accessToken, result.refreshToken);
  return res;
});
