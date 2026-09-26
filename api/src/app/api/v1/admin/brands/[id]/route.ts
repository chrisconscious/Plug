import { withRoute, json } from "@/lib/http";
import { validateBody, optional, isString, isBoolean } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { updateBrand } from "@/lib/services/catalog.service";

export const PATCH = withRoute(
  { permission: "brands.manage", rateLimit: RateLimitRules.adminGeneral },
  async ({ req, user, params }) => {
    const body = await req.json().catch(() => ({}));
    const patch = validateBody(body, {
      name: optional(isString),
      slug: optional(isString),
      // Strict boolean — a `"true"`/`"false"` *string* payload would otherwise be
      // silently coerced into `active = false` instead of being rejected.
      active: optional(isBoolean),
      // Logo presentation override: "light" (white logo → shown dark on light
      // backgrounds), "dark" (show as uploaded) or "auto" (clear override).
      logoTone: optional((v, f) => {
        const t = isString(v, f);
        if (t !== "light" && t !== "dark" && t !== "auto") {
          throw new ValidationError("Validation failed.", { [f]: 'Must be "light", "dark" or "auto".' });
        }
        return t as "light" | "dark" | "auto";
      }),
    });
    const brand = await updateBrand(user!, params.id!, patch);
    return json({ brand });
  }
);
