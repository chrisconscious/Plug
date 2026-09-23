import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadLogo, removeLogo } from "@/lib/services/platform-settings.service";
import { platformBrandingStorage } from "@/lib/storage/storage";

/**
 * POST   /api/v1/admin/platform-settings/logo   Upload or replace the platform logo.
 * DELETE /api/v1/admin/platform-settings/logo   Remove it (falls back to text).
 *
 * Multipart body with a single `file` field — same shape as every other
 * image upload in this app (see brands/[id]/logo/route.ts). Validation
 * (content-type sniffing, dimension/size limits, EXIF stripping) happens
 * inside media.service.ts's uploadMedia — this route does not duplicate it.
 */
export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the logo image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const settings = await uploadLogo(user!, platformBrandingStorage, data, file.name || null);
  return json({ settings }, { status: 201 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user }) => {
  const settings = await removeLogo(user!, platformBrandingStorage);
  return json({ settings });
});
