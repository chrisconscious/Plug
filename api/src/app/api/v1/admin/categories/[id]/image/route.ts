import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { uploadCategoryImage, removeCategoryImage } from "@/lib/services/catalog.service";
import { categoryImageStorage } from "@/lib/storage/storage";

export const POST = withRoute({ permission: "products.create", rateLimit: RateLimitRules.uploads }, async ({ req, user, params }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    throw new ValidationError("Provide a 'file' multipart field containing the category image.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const category = await uploadCategoryImage(user!, params.id!, categoryImageStorage, data, file.name || null);
  return json({ category }, { status: 201 });
});

export const DELETE = withRoute({ permission: "products.create", rateLimit: RateLimitRules.uploads }, async ({ user, params }) => {
  const category = await removeCategoryImage(user!, params.id!, categoryImageStorage);
  return json({ category });
});
