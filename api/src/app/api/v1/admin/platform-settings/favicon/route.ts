import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadFavicon, removeFavicon } from "@/lib/services/platform-settings.service";
import { platformBrandingStorage } from "@/lib/storage/storage";

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the favicon image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const settings = await uploadFavicon(user!, platformBrandingStorage, data, file.name || null);
  return json({ settings }, { status: 201 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user }) => {
  const settings = await removeFavicon(user!, platformBrandingStorage);
  return json({ settings });
});
