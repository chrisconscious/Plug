import { withRoute, json } from "@/lib/http";
import { validateBody, isEmail, isPhoneNumber, isStrongPassword, isString, maxLength, required, optional } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { registerCustomer, registerCustomerByPhone } from "@/lib/services/auth.service";
import { touchLastLogin } from "@/lib/db/repos/users.repo";
import { createAccessToken, createRefreshToken, setAuthCookies, type SessionUser } from "@/lib/security/tokens";
import { config } from "@/lib/config";

const isFullName = (value: unknown, fieldName: string) => maxLength(200)(isString(value, fieldName), fieldName);

/**
 * Phone number is the primary sign-up field now (see migration 0037) —
 * the storefront's registration form only ever sends phoneNumber. Email
 * is still accepted for any caller that still uses it (e.g. an admin
 * tool, or a not-yet-updated client), but a request must provide
 * exactly one of the two, not both and not neither, so it's always
 * unambiguous which registration path actually ran.
 */
export const POST = withRoute({ auth: "none", rateLimit: RateLimitRules.register }, async ({ req }) => {
  const body = await req.json().catch(() => ({}));
  const { password, fullName, phoneNumber, email } = validateBody(body, {
    password: required(isStrongPassword),
    fullName: optional(isFullName),
    phoneNumber: optional(isPhoneNumber),
    email: optional(isEmail),
  });

  const hasPhone = phoneNumber !== undefined;
  const hasEmail = email !== undefined;
  if (hasPhone === hasEmail) {
    throw new ValidationError("Validation failed.", { phoneNumber: "Provide a mobile number to register." });
  }

  const user = hasPhone
    ? await registerCustomerByPhone(phoneNumber!, password, fullName)
    : await registerCustomer(email!, password, fullName);

  // Establish a session immediately so a newly registered customer is
  // logged in and can use the cart right away (mirrors login behavior).
  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  const accessToken = createAccessToken(sessionUser);
  const { token: refreshToken } = await createRefreshToken(sessionUser);
  const res = json({ user, accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds }, { status: 201 });
  setAuthCookies(res, accessToken, refreshToken);
  await touchLastLogin(user.id).catch(() => undefined); // registration signs the customer in
  return res;
});
