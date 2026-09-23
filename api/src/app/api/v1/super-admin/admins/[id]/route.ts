import { withRoute, json } from "@/lib/http";
import { validateBody, optional, required, isString, isBoolean } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { setAdminDisabled, changeAdminRole } from "@/lib/services/admin.service";

// A single PATCH endpoint handling both "disable/enable" and "change role" —
// each is validated and audited independently in admin.service.ts. Kept as
// one endpoint since both are "edit this admin" from the Super Admin UI's
// point of view; the two service functions stay separate for clear,
// individually-audited actions.
export const PATCH = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));
  const { disabled, role, actorPassword } = validateBody(body, {
    // Strict boolean — a `"false"` *string* payload must be rejected, not
    // coerced (Boolean("false") would hard-disable the admin).
    disabled: optional(isBoolean),
    role: optional(isString),
    actorPassword: required(isString),
  });

  let result;
  if (typeof disabled === "boolean") {
    result = await setAdminDisabled(user!, params.id!, disabled, actorPassword);
  }
  if (role !== undefined) {
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      throw new ValidationError("Validation failed.", { role: "Must be ADMIN or SUPER_ADMIN." });
    }
    result = await changeAdminRole(user!, params.id!, role, actorPassword);
  }
  if (!result) {
    throw new ValidationError("Validation failed.", { body: "Provide `disabled` and/or `role` to update." });
  }
  return json({ admin: result });
});
