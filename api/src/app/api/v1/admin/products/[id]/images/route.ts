import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import { validateBody, isArrayOfStrings } from "@/lib/validate";
import {
  uploadProductImage,
  reorderProductImages,
} from "@/lib/services/catalog.service";
import { listImagesForProduct } from "@/lib/db/repos/catalog.repo";

/**
 * POST /api/v1/admin/products/[id]/images   Append an image (multipart `file`).
 * GET  /api/v1/admin/products/[id]/images   List the product's images (ordered).
 * PUT  /api/v1/admin/products/[id]/images   Reorder images  (body: { orderedImageIds: string[] }).
 *
 * All require `products.update`. Upload appends (position = max+1); use PUT to
 * arrange order / set the primary (first) image.
 */
export const POST = withRoute(
  { permission: "products.update", rateLimit: RateLimitRules.uploads },
  async ({ req, user, params }) => {
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!formData || !(file instanceof File)) {
      throw new ValidationError("Provide a 'file' multipart field containing the image.");
    }
    const data = Buffer.from(await file.arrayBuffer());
    const image = await uploadProductImage(user!, params.id!, { data, contentType: file.type || "", filename: file.name || null });
    return json({ image }, { status: 201 });
  }
);

export const GET = withRoute(
  { permission: "products.update", rateLimit: RateLimitRules.uploads },
  async ({ params }) => {
    const images = await listImagesForProduct(params.id!);
    return json({ images });
  }
);

export const PUT = withRoute(
  { permission: "products.update", rateLimit: RateLimitRules.uploads },
  async ({ req, user, params }) => {
    const body = await req.json().catch(() => ({}));
    const { orderedImageIds } = validateBody(body, {
      orderedImageIds: isArrayOfStrings,
    });
    const images = await reorderProductImages(user!, params.id!, orderedImageIds);
    return json({ images });
  }
);
