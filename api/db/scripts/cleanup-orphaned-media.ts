/**
 * Orphan cleanup — reconciles storage against the `media` registry (and,
 * transitively, each domain table) across all 4 upload categories, and
 * optionally deletes what it finds.
 *
 * This is the CLI counterpart to the admin routes at
 * /api/v1/admin/media/orphans (GET) and /api/v1/admin/media/orphans/cleanup
 * (POST) — same underlying MediaService.findOrphans/cleanupOrphans logic,
 * exposed here so it can run from a cron job/ops shell without going
 * through the HTTP API (and without needing an admin session to do so).
 *
 * Usage:
 *   tsx db/scripts/cleanup-orphaned-media.ts             # dry run (default, safe)
 *   tsx db/scripts/cleanup-orphaned-media.ts --apply      # actually deletes
 *
 * Exit code is 0 on success (even if orphans were found/reported), 1 if
 * any individual delete failed (see the per-category error list printed) —
 * so this is safe to wire into a monitoring/alerting pipeline that checks
 * the exit code.
 */
import { findOrphans, cleanupOrphans } from "../../src/lib/services/media.service";
import {
  brandLogoStorage,
  productImageStorage,
  heroImageStorage,
  lifestyleImageStorage,
} from "../../src/lib/storage/storage";

const APPLY = process.argv.includes("--apply");

async function main() {
  const categories = [
    { name: "brand_logos", provider: brandLogoStorage },
    { name: "product_images", provider: productImageStorage },
    { name: "hero_slides", provider: heroImageStorage },
    { name: "lifestyle_heroes", provider: lifestyleImageStorage },
  ];

  console.log(`Orphan cleanup — mode: ${APPLY ? "APPLY (will delete)" : "DRY RUN (reporting only)"}\n`);

  let totalErrors = 0;

  for (const category of categories) {
    if (APPLY) {
      const result = await cleanupOrphans(category.provider, { dryRun: false });
      console.log(
        `[${category.name}] deleted ${result.deletedStorageKeys.length} orphaned file(s), ` +
        `${result.deletedMediaRecords.length} stale media record(s)` +
        (result.errors.length ? `, ${result.errors.length} error(s)` : "")
      );
      for (const key of result.deletedStorageKeys) console.log(`  - deleted file: ${key}`);
      for (const id of result.deletedMediaRecords) console.log(`  - deleted media record: ${id}`);
      for (const err of result.errors) {
        console.error(`  ! error on ${err.key}: ${err.error}`);
        totalErrors++;
      }
    } else {
      const result = await findOrphans(category.provider);
      console.log(
        `[${category.name}] would delete ${result.orphanedStorageKeys.length} orphaned file(s), ` +
        `${result.orphanedMediaRecords.length} stale media record(s)`
      );
      for (const key of result.orphanedStorageKeys) console.log(`  - would delete file: ${key}`);
      for (const rec of result.orphanedMediaRecords) console.log(`  - would delete media record: ${rec.id} (${rec.entityType})`);
    }
  }

  if (!APPLY) {
    console.log("\nThis was a dry run — nothing was deleted. Re-run with --apply to actually delete.");
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Orphan cleanup failed:", err);
  process.exit(1);
});
