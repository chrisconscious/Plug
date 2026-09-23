import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { createLifestyle, listLifestylesAdmin, type CreateLifestyleInput } from "@/lib/services/lifestyles.service";

export const GET = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const items = await listLifestylesAdmin();
  return json({ items });
});

export const POST = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));

  const str = (v: unknown, max = 240) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") throw new ValidationError("Validation failed.", { name: "Must be a string." });
    const t = v.trim();
    if (t.length > max) throw new ValidationError("Validation failed.", { name: "Too long." });
    return t;
  };

  const input: CreateLifestyleInput = {
    name: str(body.name)!,
    slug: str(body.slug),
    shortDescription: str(body.shortDescription, 500) ?? null,
    active: body.active === undefined ? false : Boolean(body.active),
    displayOrder: body.displayOrder,
  };
  const lifestyle = await createLifestyle(user!, input);
  return json({ lifestyle }, { status: 201 });
});