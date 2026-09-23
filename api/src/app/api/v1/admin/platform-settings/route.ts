import { withRoute, json } from "@/lib/http";
import { validateBody, optional, isString, isBoolean } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import {
  updatePlatformName,
  updateTagline,
  setPwaInstallPromptEnabled,
  setDeliveryFees,
  setCodMessage,
  getPlatformSettings,
} from "@/lib/services/platform-settings.service";
import { ValidationError } from "@/lib/errors";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const settings = await getPlatformSettings();
  return json({ settings });
});

/**
 * Accepts platformName, tagline (null clears it), pwaInstallPromptEnabled,
 * darEsSalaamFeeTzs, outsideDarFeeTzs, and/or codMessage (null clears it,
 * falling back to the service layer's built-in default text). Logo/
 * favicon/PWA icon are handled by their own sub-routes (multipart uploads
 * don't mix well with a JSON PATCH body) — see ./logo, ./favicon, ./pwa-icon.
 * The two delivery fees are always set together (setDeliveryFees takes
 * both) since they're validated and audited as one change, matching how
 * the admin UI presents them as a single "delivery fees" section.
 */
export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { platformName, tagline, pwaInstallPromptEnabled, darEsSalaamFeeTzs, outsideDarFeeTzs, codMessage } = validateBody(body, {
    platformName: optional(isString),
    tagline: optional((value: unknown, fieldName: string) => {
      if (value === null) return null;
      if (typeof value !== "string") throw new ValidationError("Validation failed.", { [fieldName]: "Must be a string or null." });
      return value;
    }),
    pwaInstallPromptEnabled: optional(isBoolean),
    darEsSalaamFeeTzs: optional((value: unknown) => value),
    outsideDarFeeTzs: optional((value: unknown) => value),
    codMessage: optional((value: unknown, fieldName: string) => {
      if (value === null) return null;
      if (typeof value !== "string") throw new ValidationError("Validation failed.", { [fieldName]: "Must be a string or null." });
      return value;
    }),
  });

  const nothingProvided =
    platformName === undefined &&
    tagline === undefined &&
    pwaInstallPromptEnabled === undefined &&
    darEsSalaamFeeTzs === undefined &&
    outsideDarFeeTzs === undefined &&
    codMessage === undefined;
  if (nothingProvided) {
    throw new ValidationError("Validation failed.", { body: "Provide at least one field to update." });
  }

  let settings = await getPlatformSettings();
  if (platformName !== undefined) settings = await updatePlatformName(user!, platformName);
  if (tagline !== undefined) settings = await updateTagline(user!, tagline);
  if (pwaInstallPromptEnabled !== undefined) settings = await setPwaInstallPromptEnabled(user!, pwaInstallPromptEnabled);
  if (darEsSalaamFeeTzs !== undefined || outsideDarFeeTzs !== undefined) {
    settings = await setDeliveryFees(
      user!,
      darEsSalaamFeeTzs !== undefined ? darEsSalaamFeeTzs : settings.darEsSalaamFeeTzs,
      outsideDarFeeTzs !== undefined ? outsideDarFeeTzs : settings.outsideDarFeeTzs
    );
  }
  if (codMessage !== undefined) settings = await setCodMessage(user!, codMessage);

  return json({ settings });
});
