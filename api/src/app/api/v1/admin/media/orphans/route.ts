import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { findOrphans } from "@/lib/services/media.service";
import { brandLogoStorage, productImageStorage, heroImageStorage, lifestyleImageStorage } from "@/lib/storage/storage";

/**
 * GET /api/v1/admin/media/orphans
 *
 * Read-only scan across every upload category — reconciles what's actually
 * in storage against what the `media` registry (and, transitively, each
 * domain table) knows about. Nothing is deleted here; see
 * POST .../cleanup for that. Restricted to `system.manage` (Super Admin
 * only) since this touches every upload category at once, not a single
 * resource an Admin would normally manage.
 */
export const GET = withRoute(
  { permission: "system.manage", rateLimit: RateLimitRules.adminGeneral },
  async () => {
    const categories = [
      { name: "brand_logos", provider: brandLogoStorage },
      { name: "product_images", provider: productImageStorage },
      { name: "hero_slides", provider: heroImageStorage },
      { name: "lifestyle_heroes", provider: lifestyleImageStorage },
    ];

    const results = await Promise.all(
      categories.map(async (c) => ({ category: c.name, ...(await findOrphans(c.provider)) }))
    );

    const totalOrphanedStorageKeys = results.reduce((sum, r) => sum + r.orphanedStorageKeys.length, 0);
    const totalOrphanedMediaRecords = results.reduce((sum, r) => sum + r.orphanedMediaRecords.length, 0);

    return json({
      categories: results,
      summary: { totalOrphanedStorageKeys, totalOrphanedMediaRecords },
    });
  }
);
