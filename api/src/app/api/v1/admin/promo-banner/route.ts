import { withRoute, json } from "@/lib/http";
import { validateBody, required, optional, isBoolean } from "@/lib/validate";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { getPromoBannerSettings, updatePromoBannerSettings } from "@/lib/db/repos/promo-banner.repo";
import { recordAuditEvent } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";

export const GET = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async () => {
  const settings = await getPromoBannerSettings();
  return json({ messages: settings?.messages ?? [], isActive: settings?.isActive ?? true });
});

export const PATCH = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.adminGeneral }, async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { messages, isActive } = validateBody(body, {
    messages: required((value: unknown, fieldName: string) => {
      if (!Array.isArray(value) || !value.every((m) => typeof m === "string")) {
        throw new ValidationError("Validation failed.", { [fieldName]: "Must be an array of strings." });
      }
      if (value.length > 10) {
        throw new ValidationError("Validation failed.", { [fieldName]: "Maximum 10 messages." });
      }
      for (const m of value) {
        if (m.length > 200) throw new ValidationError("Validation failed.", { [fieldName]: "Each message must be at most 200 characters." });
      }
      return value as string[];
    }),
    isActive: optional(isBoolean),
  });

  const updated = await updatePromoBannerSettings(
    { messages, isActive: isActive ?? true },
    user!.id
  );

  await recordAuditEvent({
    actorId: user!.id,
    actorRole: user!.role,
    action: "homepage.promo_banner.updated",
    targetType: "homepage_promo_banner",
    targetId: "1",
    metadata: { messageCount: updated.messages.length, isActive: updated.isActive },
  });

  return json({ messages: updated.messages, isActive: updated.isActive });
});
