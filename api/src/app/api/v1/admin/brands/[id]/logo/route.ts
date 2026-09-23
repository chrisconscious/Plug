import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import {
  uploadBrandLogo,
  replaceBrandLogo,
  removeBrandLogo,
} from "@/lib/services/catalog.service";

/**
 * POST  /api/v1/admin/brands/[id]/logo   Upload or replace a brand logo.
 * DELETE /api/v1/admin/brands/[id]/logo  Remove a brand logo.
 *
 * Multipart body with a single `file` field. The same POST endpoint serves
 * both first-upload and replacement: if the brand already has a logo it is
 * replaced (audit brand.logo.replaced), otherwise created (brand.logo.uploaded).
 */
export const POST = withRoute(
  { permission: "brands.manage", rateLimit: RateLimitRules.uploads },
  async ({ req, user, params }) => {
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!formData || !(file instanceof File)) {
      throw new ValidationError("Provide a 'file' multipart field containing the logo image.");
    }

    const data = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "";

    const logo = await uploadBrandLogo(user!, params.id!, { data, contentType, filename: file.name || null });
    return json({ logo }, { status: 201 });
  }
);

export const DELETE = withRoute(
  { permission: "brands.manage", rateLimit: RateLimitRules.uploads },
  async ({ user, params }) => {
    await removeBrandLogo(user!, params.id!);
    return json({ success: true });
  }
);
