import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { ValidationError } from "@/lib/errors";
import {
  uploadBrandCampaignImage,
  removeBrandCampaignImage,
} from "@/lib/services/catalog.service";

/**
 * POST   /api/v1/admin/brands/[id]/campaign-image   Upload or replace a brand's large storefront campaign photo.
 * DELETE /api/v1/admin/brands/[id]/campaign-image   Remove it.
 *
 * Mirrors ./logo/route.ts exactly — same upload pipeline, same upsert
 * behavior (one POST endpoint serves both first-upload and replacement).
 * This is a SEPARATE asset from the logo (migration 0045's own header
 * explains why): a small logo mark vs. a large lifestyle photo used by
 * the storefront's Shop by Brand cards.
 */
export const POST = withRoute(
  { permission: "brands.manage", rateLimit: RateLimitRules.uploads },
  async ({ req, user, params }) => {
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!formData || !(file instanceof File)) {
      throw new ValidationError("Provide a 'file' multipart field containing the campaign image.");
    }

    const data = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "";

    const campaignImage = await uploadBrandCampaignImage(user!, params.id!, { data, contentType, filename: file.name || null });
    return json({ campaignImage }, { status: 201 });
  }
);

export const DELETE = withRoute(
  { permission: "brands.manage", rateLimit: RateLimitRules.uploads },
  async ({ user, params }) => {
    await removeBrandCampaignImage(user!, params.id!);
    return json({ success: true });
  }
);
