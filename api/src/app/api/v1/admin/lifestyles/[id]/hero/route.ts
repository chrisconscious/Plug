import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadLifestyleHero, removeLifestyleHero } from "@/lib/services/lifestyles.service";

// Upsert semantics (mirrors the brand-logo pipeline): POST uploads — or, when
// an image already exists, replaces it (old storage object cleaned up).
// DELETE removes the image (only allowed while the lifestyle is inactive).
export const POST = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user, params }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const lifestyle = await uploadLifestyleHero(user!, params.id!, { data, contentType: file.type || "", filename: file.name || null });
  return json({ lifestyle }, { status: 200 });
});

export const DELETE = withRoute({ permission: "lifestyles.manage", rateLimit: RateLimitRules.uploads }, async ({ user, params }) => {
  const lifestyle = await removeLifestyleHero(user!, params.id!);
  return json({ lifestyle });
});