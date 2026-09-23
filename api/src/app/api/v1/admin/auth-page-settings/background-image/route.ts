import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadBackgroundImage, removeBackgroundImage } from "@/lib/services/auth-page-settings.service";
import { authPageStorage } from "@/lib/storage/storage";

export const POST = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the background image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const settings = await uploadBackgroundImage(user!, authPageStorage, data, file.name || null);
  return json({ settings }, { status: 201 });
});

export const DELETE = withRoute({ permission: "content.manage", rateLimit: RateLimitRules.uploads }, async ({ user }) => {
  const settings = await removeBackgroundImage(user!, authPageStorage);
  return json({ settings });
});