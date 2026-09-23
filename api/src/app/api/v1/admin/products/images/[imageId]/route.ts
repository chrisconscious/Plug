import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import {
  replaceProductImage,
  deleteProductImage,
} from "@/lib/services/catalog.service";

/**
 * PATCH  /api/v1/admin/products/images/[imageId]   Replace one image (multipart `file`).
 * DELETE /api/v1/admin/products/images/[imageId]   Delete one image.
 *
 * All require `products.update`. Replacing keeps the row's position (it stays
 * where it was in the gallery); only the file bytes + metadata change.
 */
export const PATCH = withRoute(
  { permission: "products.update", rateLimit: RateLimitRules.adminGeneral },
  async ({ req, user, params }) => {
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!formData || !(file instanceof File)) {
      throw new ValidationError("Provide a 'file' multipart field containing the replacement image.");
    }
    const data = Buffer.from(await file.arrayBuffer());
    const image = await replaceProductImage(user!, params.imageId!, { data, contentType: file.type || "", filename: file.name || null });
    return json({ image });
  }
);

export const DELETE = withRoute(
  { permission: "products.update", rateLimit: RateLimitRules.adminGeneral },
  async ({ user, params }) => {
    await deleteProductImage(user!, params.imageId!);
    return json({ success: true });
  }
);
