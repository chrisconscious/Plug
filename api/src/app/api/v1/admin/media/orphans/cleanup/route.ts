import { withRoute, json } from "@/lib/http";
import { RateLimitRules } from "@/lib/security/rateLimiter";
import { cleanupOrphans } from "@/lib/services/media.service";
import { recordAuditEvent } from "@/lib/audit";
import { brandLogoStorage, productImageStorage, heroImageStorage, lifestyleImageStorage } from "@/lib/storage/storage";

/**
 * POST /api/v1/admin/media/orphans/cleanup
 *
 * Actually deletes what GET /api/v1/admin/media/orphans finds. Destructive
 * — restricted to `system.manage` (Super Admin only), audit-logged with
 * the exact counts deleted per category, and still defaults to a dry run
 * unless the request body explicitly says otherwise (belt-and-suspenders:
 * an admin clicking the wrong button should see a report, not lost files).
 */
export const POST = withRoute(
  { permission: "system.manage", rateLimit: RateLimitRules.adminGeneral },
  async ({ req, user }) => {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false; // must explicitly pass `dryRun: false` to actually delete anything

    const categories = [
      { name: "brand_logos", provider: brandLogoStorage },
      { name: "product_images", provider: productImageStorage },
      { name: "hero_slides", provider: heroImageStorage },
      { name: "lifestyle_heroes", provider: lifestyleImageStorage },
    ];

    const results = await Promise.all(
      categories.map(async (c) => ({ category: c.name, ...(await cleanupOrphans(c.provider, { dryRun })) }))
    );

    const totalDeletedStorageKeys = results.reduce((sum, r) => sum + r.deletedStorageKeys.length, 0);
    const totalDeletedMediaRecords = results.reduce((sum, r) => sum + r.deletedMediaRecords.length, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    await recordAuditEvent({
      actorId: user!.id,
      actorRole: user!.role,
      action: dryRun ? "media.orphans.scanned" : "media.orphans.cleaned_up",
      targetType: "media",
      targetId: "all-categories",
      metadata: { dryRun, totalDeletedStorageKeys, totalDeletedMediaRecords, totalErrors, categories: results.map((r) => r.category) },
    });

    return json({
      dryRun,
      categories: results,
      summary: { totalDeletedStorageKeys, totalDeletedMediaRecords, totalErrors },
    });
  }
);
