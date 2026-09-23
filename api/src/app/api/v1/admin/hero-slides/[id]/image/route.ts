import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { removeHeroImage, storeHeroImage } from "@/lib/services/hero.service";

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user, params }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const slide = await storeHeroImage(user!, params.id!, { data, contentType: file.type || "", filename: file.name || null });
  return json({ slide }, { status: 200 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user, params }) => {
  const slide = await removeHeroImage(user!, params.id!);
  return json({ slide });
});
