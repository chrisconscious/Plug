import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadPwaIcon, removePwaIcon } from "@/lib/services/platform-settings.service";
import { platformBrandingStorage } from "@/lib/storage/storage";

/**
 * POST   /api/v1/admin/platform-settings/pwa-icon   Upload or replace the PWA app icon.
 * DELETE /api/v1/admin/platform-settings/pwa-icon   Remove it (falls back to the platform logo, then a generic placeholder).
 * Mirrors the logo route exactly — same upload pipeline, same storage bucket.
 */
export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the app icon image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const settings = await uploadPwaIcon(user!, platformBrandingStorage, data, file.name || null);
  return json({ settings }, { status: 201 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user }) => {
  const settings = await removePwaIcon(user!, platformBrandingStorage);
  return json({ settings });
});
