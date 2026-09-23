import { withRoute, json } from "@/lib/http";
import { validateBody, required, isEmail, isStrongPassword, isString } from "@/lib/validate";
import { ValidationError } from "@/lib/errors";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { listAdmins, createAdmin } from "@/lib/services/admin.service";

export const GET = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  return json({ admins: await listAdmins() });
});

export const POST = withRoute({ permission: "admins.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const input = validateBody(body, {
    email: required(isEmail),
    password: required(isStrongPassword),
    role: required(isString),
    actorPassword: required(isString),
  });
  if (input.role !== "ADMIN" && input.role !== "SUPER_ADMIN") {
    throw new ValidationError("Validation failed.", { role: "Must be ADMIN or SUPER_ADMIN." });
  }
  const admin = await createAdmin(user!, { ...input, role: input.role });
  return json({ admin }, { status: 201 });
});
