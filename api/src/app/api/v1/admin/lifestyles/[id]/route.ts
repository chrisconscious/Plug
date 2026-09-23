import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { updateLifestyle, deleteLifestyle, type UpdateLifestylePatch } from "@/lib/services/lifestyles.service";

export const PATCH = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user, params }) => {
  const body = await req.json().catch(() => ({}));

  const str = (v: unknown, max = 240) => {
    if (v === undefined) return undefined; // omitted — leave unchanged
    if (v === null) return null;
    if (typeof v !== "string") throw new ValidationError("Validation failed.", { name: "Must be a string." });
    const t = v.trim();
    if (t.length > max) throw new ValidationError("Validation failed.", { name: "Too long." });
    return t;
  };

  const patch: UpdateLifestylePatch = {};
  if (body.name !== undefined) patch.name = str(body.name, 240) as string;
  if (body.slug !== undefined) patch.slug = str(body.slug, 100) as string;
  if (body.shortDescription !== undefined) patch.shortDescription = str(body.shortDescription, 500);
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder;

  const lifestyle = await updateLifestyle(user!, params.id!, patch);
  return json({ lifestyle });
});

export const DELETE = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ user, params }) => {
  const result = await deleteLifestyle(user!, params.id!);
  return json(result);
});